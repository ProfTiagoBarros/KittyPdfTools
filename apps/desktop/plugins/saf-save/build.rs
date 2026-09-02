const COMMANDS: &[&str] = &["save_to_uri", "discard_uri"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
