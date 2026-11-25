// Fiskesim som Mac-app: nettsiden ligger i appen og vises fra http://localhost (som i en vanlig nettleser,
// så kartbiblioteket, trådene og lagringen virker likt). Kartdataene hentes fra nettet eller fra områdene
// du har lastet ned (offline-lageret i appen).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

// fast port, så lagrede områder og innstillinger (som hører til adressen) følger med mellom oppstartene
const PORT: u16 = 47815;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_localhost::Builder::new(PORT).build())
        .setup(|app| {
            let url = format!("http://localhost:{}", PORT).parse().unwrap();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Fiskesim")
                .inner_size(1280.0, 860.0)
                .min_inner_size(480.0, 520.0)
                .devtools(true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Fiskesim kunne ikke starte");
}
