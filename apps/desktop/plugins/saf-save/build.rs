const COMMANDS: &[&str] = &["write_chunk", "finish_write", "copy_saved", "discard_uri"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
