#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

struct DaemonProcess(Mutex<Option<Child>>);

fn facade_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 4777));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request = b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:4777\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut response = [0_u8; 64];
    let Ok(read) = stream.read(&mut response) else {
        return false;
    };
    String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 200")
}

fn wait_for_facade(child: &mut Child) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("desktop stack exited before facade readiness: {status}"));
        }
        if facade_ready() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err("desktop facade did not become healthy within 30 seconds".to_string())
}

fn terminate_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn main() {
    tauri::Builder::default()
        .manage(DaemonProcess(Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
            let node_name = if cfg!(windows) { "node.exe" } else { "node" };
            let node = resource_dir.join("runtime").join(node_name);
            let launcher = resource_dir.join("stack-launcher.mjs");
            if node.exists() && launcher.exists() {
                let mut child = Command::new(node)
                    .arg(&launcher)
                    .current_dir(&resource_dir)
                    .env("AIDE_WORKSPACE", &resource_dir)
                    .env("AIDE_MODEL_DIR", resource_dir.join("models"))
                    .env("AIDE_ARCH_PORT", "4778")
                    .env("AIDE_LEGACY_PORT", "4779")
                    .env("AIDE_FACADE_PORT", "4777")
                    .env("AIDE_LLAMA_SERVER", resource_dir.join("runtime").join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" }))
                    .spawn()
                    .map_err(|error| error.to_string())?;
                if let Err(error) = wait_for_facade(&mut child) {
                    terminate_tree(&mut child);
                    return Err(error.into());
                }
                let state = app.state::<DaemonProcess>();
                *state.0.lock().map_err(|error| error.to_string())? = Some(child);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AIDE desktop shell")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(mut child) = app.state::<DaemonProcess>().0.lock().ok().and_then(|mut state| state.take()) {
                    terminate_tree(&mut child);
                }
            }
        });
}
