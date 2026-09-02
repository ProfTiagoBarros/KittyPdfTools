/// Ponto de entrada do aplicativo Desktop.
///
/// O Desktop nao acrescenta logica de PDF: ele empacota o mesmo export estatico do
/// `apps/web`. Toda a manipulacao continua acontecendo em Web Workers dentro do WebView,
/// como no navegador — um unico caminho de codigo, uma unica coisa a testar.
///
/// A Regra de Ouro 4 (offline) e satisfeita por construcao: os assets do pdf.js e do
/// Tesseract sao copiados para `public/` no build do web e viajam dentro do pacote.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        // Salvar o PDF pronto e a unica coisa que o app instalado faz melhor que a aba do
        // navegador: o `<a download>` grava sem perguntar no desktop, e no WebView do Android
        // nao grava nada. O seletor do sistema resolve os dois casos.
        //
        // Isso NAO abre excecao a Regra de Ouro 1: o destino e o proprio aparelho.
        .plugin(tauri_plugin_dialog::init())
        // O `tauri-plugin-fs` foi retirado de proposito: no Android ele grava por um descritor
        // destacado, e o documento fica registrado com zero bytes — o arquivo existe no disco e
        // e ilegivel para qualquer app. O plugin abaixo grava pelo canal que o sistema observa.
        .plugin(tauri_plugin_saf_save::init())
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o PDFKitty");
}
