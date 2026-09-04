#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct StackProcess(Mutex<Option<Child>>);

fn as_io_error(error: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
}

fn stop_stack(mut child: Child) {
    if cfg!(windows) {
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", pid.as_str(), "/T", "/F"])
            .status();
    } else {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn main() {
    tauri::Builder::default()
        .manage(StackProcess(Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app.path().resource_dir().map_err(as_io_error)?;
            let app_data_dir = app.path().app_local_data_dir().map_err(as_io_error)?;
            let workspace_dir = app_data_dir.join("workspace");
            let model_dir = app_data_dir.join("models");
            std::fs::create_dir_all(&workspace_dir).map_err(as_io_error)?;
            std::fs::create_dir_all(&model_dir).map_err(as_io_error)?;
            let node_name = if cfg!(windows) { "node.exe" } else { "node" };
            let node = resource_dir.join("runtime").join(node_name);
            let launcher = resource_dir.join("stack-launcher.mjs");
            let required = [
                &node,
                &launcher,
                &resource_dir.join("node").join("src").join("server.ts"),
                &resource_dir.join("daemon").join("server.mjs"),
                &resource_dir.join("scripts").join("facade.mjs"),
                &resource_dir.join("common").join("facade-route-map.json"),
            ];
            if required.iter().any(|file| !file.exists()) {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("AIDE resources are incomplete under {}", resource_dir.display()),
                ).into());
            }
            let child = Command::new(node)
                .arg(launcher)
                .current_dir(&resource_dir)
                .env("AIDE_WORKSPACE", &workspace_dir)
                .env("AIDE_MODEL_DIR", &model_dir)
                .env("AIDE_LLAMA_SERVER", resource_dir.join("runtime").join(if cfg!(windows) { "llama-server.exe" } else { "llama-server" }))
                .env("AIDE_ARCH_PORT", "4778")
                .env("AIDE_LEGACY_PORT", "4779")
                .env("AIDE_FACADE_PORT", "4777")
                .env("AIDE_DAEMON_PORT", "4777")
                .spawn()
                .map_err(as_io_error)?;
            let state = app.state::<StackProcess>();
            *state.0.lock().map_err(as_io_error)? = Some(child);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AIDE desktop shell")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app.state::<StackProcess>().0.lock().ok().and_then(|mut state| state.take()) {
                    stop_stack(child);
                }
            }
        });
}
