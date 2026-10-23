const COMMANDS: &[&str] = &["save_to_uri", "copy_saved", "discard_uri"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
