// Fiskesim som Mac-app: nettsiden ligger i appen, kartdataene hentes fra nettet
// eller fra områdene du har lastet ned (offline-lageret i appen).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Fiskesim kunne ikke starte");
}
