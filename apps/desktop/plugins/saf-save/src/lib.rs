//! Grava um arquivo no destino que o usuario escolheu no seletor do sistema.
//!
//! # Por que este plugin existe
//!
//! No Android, `dialog.save()` devolve um **content URI** — o endereco de um documento que o
//! sistema acabou de criar, vazio. O `tauri-plugin-fs` grava nele pedindo um descritor de
//! arquivo ao Kotlin, que faz `parcelFileDescriptor.detachFd()`. Ao destacar o descritor, o
//! `ParcelFileDescriptor` deixa de ser dono dele: o Rust escreve e fecha o descritor cru, e o
//! provedor de documentos do Android **nunca fica sabendo que a gravacao terminou**.
//!
//! O efeito medido num Galaxy A56: o arquivo fica completo no disco bruto, mas o documento
//! registrado continua com `0 B`. Qualquer aplicativo que o abra pelo caminho normal —
//! inclusive este — recebe zero bytes. O PDF "salvo" era ilegivel.
//!
//! Aqui a gravacao passa pelo `OutputStream` do content resolver e o stream e fechado por ele,
//! que e o evento que faz o provedor atualizar o tamanho.
//!
//! Fora do Android nao ha content URI: o destino e um caminho comum e a gravacao e direta.

use std::borrow::Cow;

use serde::Serialize;
use tauri::{
    ipc::{InvokeBody, Request},
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("destino ausente no cabecalho da requisicao")]
    MissingDestination,
    #[error("o corpo da requisicao nao traz bytes")]
    SemBytes,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, Error>;

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyToUriPayload {
    source: String,
    destination: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscardPayload {
    destination: String,
}

/// Grava `bytes` (corpo binario da requisicao) no destino do cabecalho `destination`.
#[tauri::command]
async fn save_to_uri<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<()> {
    let destination = request
        .headers()
        .get("destination")
        .and_then(|value| value.to_str().ok())
        .ok_or(Error::MissingDestination)?
        .to_string();

    /*
     * Duas formas, porque o transporte muda com a plataforma.
     *
     * No desktop os bytes chegam como corpo binario. **No Android chegam como array JSON de
     * numeros** — o proprio `tauri-plugin-fs` trata os dois casos, e aceitar so o binario faz
     * o comando falhar sempre no celular, que foi exatamente o que aconteceu aqui.
     *
     * O custo do caminho JSON e alto (um PDF de 5 MB viaja como texto de dezenas de MB), mas
     * quem escolhe o transporte e o Tauri, nao nos.
     */
    let bytes: Cow<[u8]> = match request.body() {
        InvokeBody::Raw(dados) => Cow::Borrowed(dados.as_slice()),
        InvokeBody::Json(serde_json::Value::Array(valores)) => Cow::Owned(
            valores
                .iter()
                .filter_map(|valor| valor.as_u64().map(|numero| numero as u8))
                .collect(),
        ),
        _ => return Err(Error::SemBytes),
    };

    write_bytes(&app, &destination, &bytes)
}

/**
 * Descarta um destino que ficou vazio porque a geracao falhou.
 *
 * So faz sentido no Android: la o seletor CRIA o documento no momento em que o usuario
 * confirma o nome, antes de existir qualquer byte. Se a geracao falhar depois, sobra um
 * arquivo de 0 bytes na pasta do usuario.
 *
 * No desktop o seletor apenas devolve um caminho — nada foi criado, e apagar seria perigoso:
 * o usuario pode ter escolhido sobrescrever um arquivo que ja existia.
 */
#[tauri::command]
async fn discard_uri<R: Runtime>(app: AppHandle<R>, destination: String) -> Result<()> {
    discard(&app, &destination)
}

#[cfg(not(target_os = "android"))]
fn discard<R: Runtime>(_app: &AppHandle<R>, _destination: &str) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "android")]
fn discard<R: Runtime>(app: &AppHandle<R>, destination: &str) -> Result<()> {
    app.saf_save().discard_uri(destination.to_string())
}

#[cfg(not(target_os = "android"))]
fn write_bytes<R: Runtime>(_app: &AppHandle<R>, destination: &str, bytes: &[u8]) -> Result<()> {
    std::fs::write(destination, bytes)?;
    Ok(())
}

#[cfg(target_os = "android")]
fn write_bytes<R: Runtime>(app: &AppHandle<R>, destination: &str, bytes: &[u8]) -> Result<()> {
    /*
     * Passa pelo disco, e nao pela ponte, de proposito.
     *
     * Os argumentos de um comando do plugin Android trafegam como JSON: mandar os bytes por
     * ali exigiria base64, o que cresce o payload em um terco e duplica o documento inteiro na
     * memoria de um aparelho movel. Um arquivo temporario no cache do proprio app custa uma
     * copia em disco e mantem a ponte com duas strings.
     */
    let cache = app.path().app_cache_dir()?;
    std::fs::create_dir_all(&cache)?;
    let temporario = cache.join("saf-save.tmp");
    std::fs::write(&temporario, bytes)?;

    let resultado = app.saf_save().copy_to_uri(
        temporario.to_string_lossy().to_string(),
        destination.to_string(),
    );

    // O temporario sai mesmo se a copia falhar: o documento do usuario nao pode ficar
    // duplicado no cache por causa de um erro.
    let _ = std::fs::remove_file(&temporario);

    resultado
}

#[cfg(target_os = "android")]
mod android {
    use super::{CopyToUriPayload, DiscardPayload, Error, Result};
    use tauri::{
        plugin::{PluginApi, PluginHandle},
        AppHandle, Manager, Runtime,
    };

    const PLUGIN_IDENTIFIER: &str = "com.pdfkitty.safsave";

    pub struct SafSave<R: Runtime>(PluginHandle<R>);

    impl<R: Runtime> SafSave<R> {
        pub fn copy_to_uri(&self, source: String, destination: String) -> Result<()> {
            self.0
                .run_mobile_plugin::<()>(
                    "copyToUri",
                    CopyToUriPayload {
                        source,
                        destination,
                    },
                )
                .map_err(|error| Error::Io(std::io::Error::other(error.to_string())))
        }

        pub fn discard_uri(&self, destination: String) -> Result<()> {
            self.0
                .run_mobile_plugin::<()>("discardUri", DiscardPayload { destination })
                .map_err(|error| Error::Io(std::io::Error::other(error.to_string())))
        }
    }

    pub trait SafSaveExt<R: Runtime> {
        fn saf_save(&self) -> &SafSave<R>;
    }

    impl<R: Runtime, T: Manager<R>> SafSaveExt<R> for T {
        fn saf_save(&self) -> &SafSave<R> {
            self.state::<SafSave<R>>().inner()
        }
    }

    pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
        _app: &AppHandle<R>,
        api: PluginApi<R, C>,
    ) -> Result<SafSave<R>> {
        // Mapeado a mao: o erro de registro do plugin Android nao converte para o nosso.
        let handle = api
            .register_android_plugin(PLUGIN_IDENTIFIER, "SafSavePlugin")
            .map_err(|erro| Error::Io(std::io::Error::other(erro.to_string())))?;
        Ok(SafSave(handle))
    }
}

#[cfg(target_os = "android")]
use android::SafSaveExt;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("saf-save")
        .invoke_handler(tauri::generate_handler![save_to_uri, discard_uri])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let state = android::init(_app, _api)?;
                _app.manage(state);
            }
            Ok(())
        })
        .build()
}
