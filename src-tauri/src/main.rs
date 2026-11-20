// Piano on Windows: the same files as the web app (tools/build-www.js), in
// the system's own WebView (WebView2). Everything the app does lives in
// src/; this opens the window, keeps one copy running, lets the page reach
// the piano over MIDI without asking each time, and keeps the app portable
// (portable.rs: data beside the exe, updates in place).
// keel's platform.js finds it through window.__TAURI__ (withGlobalTauri).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod pdmx;
mod portable;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    let location = portable::resolve();
    let data = location.dir.clone();
    tauri::Builder::default()
        // First, so a second launch brings the running window back instead
        // of opening another copy beside it.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        // Links to other sites open in the browser (keel's platform.js).
        .plugin(tauri_plugin_opener::init())
        // Picking another folder for the data.
        .plugin(tauri_plugin_dialog::init())
        // Web MIDI asks for permission; reaching the piano is the app's whole
        // job, so it's granted. Every other request gets the WebView's own answer.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Midi => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .manage(location)
        .manage(std::sync::Arc::new(pdmx::Job::default()))
        .invoke_handler(tauri::generate_handler![
            portable::data_location,
            portable::set_data_location,
            portable::update_check,
            portable::update_install,
            catalog::catalog_page,
            catalog::catalog_file,
            pdmx::pdmx_get,
            pdmx::pdmx_cancel,
            pdmx::pdmx_status,
            pdmx::pdmx_index,
            pdmx::pdmx_file,
            pdmx::pdmx_remove
        ])
        // The window is made here, not in tauri.conf.json, to give it the
        // data folder.
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Piano")
                .inner_size(1280.0, 840.0)
                .min_inner_size(900.0, 600.0)
                .background_color(tauri::window::Color(0x1B, 0x1C, 0x1F, 0xFF))
                .disable_drag_drop_handler()
                .zoom_hotkeys_enabled(true)
                .data_directory(data.clone())
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Piano failed to start");
}
