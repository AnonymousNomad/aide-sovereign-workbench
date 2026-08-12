#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct DaemonProcess(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .manage(DaemonProcess(Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
            let node_name = if cfg!(windows) { "node.exe" } else { "node" };
            let node = resource_dir.join("runtime").join(node_name);
            let daemon = resource_dir.join("daemon").join("server.mjs");
            if node.exists() && daemon.exists() {
                let child = Command::new(node)
                    .arg(daemon)
                    .current_dir(&resource_dir)
                    .env("AIDE_WORKSPACE", &resource_dir)
                    .env("AIDE_DAEMON_PORT", "4777")
                    .spawn()
                    .map_err(|error| error.to_string())?;
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
                    let _ = child.kill();
                }
            }
        });
}
