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
    #[error("cabecalho '{0}' ausente na requisicao")]
    MissingHeader(&'static str),
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
struct CopySavedPayload {
    source: String,
    destination: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscardPayload {
    destination: String,
}

fn header<'a>(request: &'a Request<'_>, name: &'static str) -> Result<&'a str> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or(Error::MissingHeader(name))
}

/**
 * Grava um PEDACO do arquivo num temporario: o cabecalho `append` diz se comeca do zero (`0`)
 * ou acrescenta (`1`).
 *
 * Em pedacos porque o arquivo inteiro numa requisicao so era uma copia do tamanho do
 * documento dentro da ponte — 551 MB ao unir oito PDFs escaneados, somados ao que a tela ja
 * ocupava. No Android, onde o corpo vira array JSON (~3,6x maior), um arquivo assim nem cabia.
 *
 * O destino so e tocado em `finish_write`: se a gravacao falhar no meio, o arquivo que o
 * usuario escolheu sobrescrever continua inteiro.
 */
#[tauri::command]
async fn write_chunk<R: Runtime>(app: AppHandle<R>, request: Request<'_>) -> Result<()> {
    let destination = header(&request, "destination")?;
    let append = header(&request, "append")? == "1";
    let bytes = bytes_from_body(request.body())?;
    disk::write_chunk(&partial_path(&app, destination)?, &bytes, append)
}

/// Poe o temporario completo no destino escolhido.
#[tauri::command]
async fn finish_write<R: Runtime>(app: AppHandle<R>, destination: String) -> Result<()> {
    let partial = partial_path(&app, &destination)?;
    finish(&app, &partial, &destination)
}

/**
 * Os bytes do corpo da requisicao, nas duas formas em que o Tauri os entrega.
 *
 * No desktop chegam como corpo binario. **No Android chegam como array JSON de numeros** — o
 * proprio `tauri-plugin-fs` trata os dois casos, e aceitar so o binario faz o comando falhar
 * sempre no celular, que foi exatamente o que aconteceu aqui.
 *
 * Um valor do array que nao seja um byte recusa o corpo inteiro: descarta-lo ou trunca-lo
 * gravaria um PDF corrompido sem aviso nenhum.
 */
fn bytes_from_body(body: &InvokeBody) -> Result<Cow<'_, [u8]>> {
    match body {
        InvokeBody::Raw(dados) => Ok(Cow::Borrowed(dados.as_slice())),
        InvokeBody::Json(serde_json::Value::Array(valores)) => valores
            .iter()
            .map(|valor| {
                valor
                    .as_u64()
                    .and_then(|numero| u8::try_from(numero).ok())
                    .ok_or(Error::SemBytes)
            })
            .collect::<Result<Vec<u8>>>()
            .map(Cow::Owned),
        _ => Err(Error::SemBytes),
    }
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
    // O temporario de uma gravacao interrompida tambem sai: e uma copia do documento.
    let _ = std::fs::remove_file(partial_path(&app, &destination)?);
    discard(&app, &destination)
}

/**
 * Copia um arquivo ja gravado para um novo destino — o "salvar de novo".
 *
 * Existe para a interface NAO guardar o documento gerado na memoria. Guardar custava o
 * tamanho inteiro do arquivo enquanto o app estivesse aberto (288 MB depois de juntar dois
 * PDFs de 200 paginas), e cada operacao seguinte comecava desse patamar — num Windows 32 bits,
 * com ~2 GB por processo, isso era a diferenca entre a segunda juncao funcionar ou travar.
 *
 * Origem igual ao destino nao faz nada, de proposito: abrir o destino para escrita o
 * TRUNCA, e sendo o mesmo arquivo, a origem seria zerada antes de ser lida.
 */
#[tauri::command]
async fn copy_saved<R: Runtime>(
    app: AppHandle<R>,
    source: String,
    destination: String,
) -> Result<()> {
    if source == destination {
        return Ok(());
    }
    copy_saved_file(&app, &source, &destination)
}

#[cfg(not(target_os = "android"))]
fn copy_saved_file<R: Runtime>(_app: &AppHandle<R>, source: &str, destination: &str) -> Result<()> {
    disk::copy(std::path::Path::new(source), std::path::Path::new(destination))
}

#[cfg(target_os = "android")]
fn copy_saved_file<R: Runtime>(app: &AppHandle<R>, source: &str, destination: &str) -> Result<()> {
    // No Android os dois lados sao content URIs: quem le e escreve e o content resolver.
    app.saf_save().copy_saved(source.to_string(), destination.to_string())
}

#[cfg(not(target_os = "android"))]
fn discard<R: Runtime>(_app: &AppHandle<R>, _destination: &str) -> Result<()> {
    Ok(())
}

#[cfg(target_os = "android")]
fn discard<R: Runtime>(app: &AppHandle<R>, destination: &str) -> Result<()> {
    app.saf_save().discard_uri(destination.to_string())
}

/// No desktop o temporario fica AO LADO do destino: mesmo volume, entao `rename` o poe no lugar
/// de uma vez, sem copiar de novo.
#[cfg(not(target_os = "android"))]
fn partial_path<R: Runtime>(_app: &AppHandle<R>, destination: &str) -> Result<std::path::PathBuf> {
    Ok(disk::partial_path(std::path::Path::new(destination)))
}

/// No Android o destino e um content URI, sem pasta onde por um vizinho: o temporario vai para o
/// cache do proprio app.
#[cfg(target_os = "android")]
fn partial_path<R: Runtime>(app: &AppHandle<R>, destination: &str) -> Result<std::path::PathBuf> {
    use std::hash::{Hash, Hasher};
    let cache = app.path().app_cache_dir()?;
    std::fs::create_dir_all(&cache)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    destination.hash(&mut hasher);
    Ok(cache.join(format!("saf-save-{:016x}.tmp", hasher.finish())))
}

#[cfg(not(target_os = "android"))]
fn finish<R: Runtime>(_app: &AppHandle<R>, partial: &std::path::Path, destination: &str) -> Result<()> {
    disk::finish(partial, std::path::Path::new(destination))
}

#[cfg(target_os = "android")]
fn finish<R: Runtime>(app: &AppHandle<R>, partial: &std::path::Path, destination: &str) -> Result<()> {
    /*
     * Passa pelo disco, e nao pela ponte, de proposito: os argumentos de um comando do plugin
     * Android trafegam como JSON, e mandar o documento por ali duplicaria o arquivo inteiro na
     * memoria do aparelho. O Kotlin copia do temporario para o documento pelo content resolver.
     */
    let resultado = app.saf_save().copy_to_uri(
        partial.to_string_lossy().to_string(),
        destination.to_string(),
    );

    // O temporario sai mesmo se a copia falhar: o documento do usuario nao pode ficar
    // duplicado no cache por causa de um erro.
    let _ = std::fs::remove_file(partial);

    resultado
}

/// Operacoes de arquivo puras, separadas do `AppHandle` para serem testaveis sem subir o Tauri.
#[cfg_attr(target_os = "android", allow(dead_code))]
mod disk {
    use super::Result;
    use std::io::Write;
    use std::path::{Path, PathBuf};

    /// Grava um pedaco: do zero quando `append` e falso, no fim do arquivo quando verdadeiro.
    pub fn write_chunk(path: &Path, bytes: &[u8], append: bool) -> Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(path)?;
        file.write_all(bytes)?;
        Ok(())
    }

    pub fn partial_path(destination: &Path) -> PathBuf {
        let mut nome = destination.as_os_str().to_owned();
        nome.push(".pdfkitty-parcial");
        PathBuf::from(nome)
    }

    /// Troca o destino pelo temporario completo. Substitui o arquivo que ja existia la.
    pub fn finish(partial: &Path, destination: &Path) -> Result<()> {
        std::fs::rename(partial, destination)?;
        Ok(())
    }

    /// Copia o arquivo salvo. O mesmo arquivo nao e copiado sobre si mesmo: abrir o destino
    /// para escrita o trunca, e a origem seria zerada antes de ser lida. A comparacao e pelo
    /// caminho canonico porque `C:\a.pdf` e `c:\A.PDF` sao o mesmo arquivo no Windows.
    pub fn copy(source: &Path, destination: &Path) -> Result<()> {
        if same_file(source, destination) {
            return Ok(());
        }
        std::fs::copy(source, destination)?;
        Ok(())
    }

    fn same_file(a: &Path, b: &Path) -> bool {
        match (a.canonicalize(), b.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            // O destino ainda nao existe: nao pode ser a origem.
            _ => false,
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::{CopySavedPayload, CopyToUriPayload, DiscardPayload, Error, Result};
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

        pub fn copy_saved(&self, source: String, destination: String) -> Result<()> {
            self.0
                .run_mobile_plugin::<()>(
                    "copySaved",
                    CopySavedPayload {
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
        .invoke_handler(tauri::generate_handler![
            write_chunk,
            finish_write,
            copy_saved,
            discard_uri
        ])
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpo_binario_passa_sem_copia() {
        let corpo = InvokeBody::Raw(vec![0x25, 0x50, 0x44, 0x46]);
        let bytes = bytes_from_body(&corpo).unwrap();
        assert!(matches!(bytes, Cow::Borrowed(_)));
        assert_eq!(&*bytes, b"%PDF");
    }

    #[test]
    fn corpo_json_do_android_vira_bytes() {
        let corpo = InvokeBody::Json(serde_json::json!([37, 80, 68, 70, 0, 255]));
        assert_eq!(&*bytes_from_body(&corpo).unwrap(), &[37, 80, 68, 70, 0, 255]);
    }

    #[test]
    fn valor_que_nao_e_byte_recusa_o_corpo_inteiro() {
        for invalido in [serde_json::json!([37, 256]), serde_json::json!([37, -1]), serde_json::json!([37, "x"])] {
            assert!(matches!(bytes_from_body(&InvokeBody::Json(invalido)), Err(Error::SemBytes)));
        }
        assert!(matches!(bytes_from_body(&InvokeBody::Json(serde_json::json!({}))), Err(Error::SemBytes)));
    }

    #[cfg(not(target_os = "android"))]
    mod disco {
        use super::super::disk;
        use std::fs;
        use std::path::{Path, PathBuf};

        fn pasta(nome: &str) -> PathBuf {
            let pasta = std::env::temp_dir().join(format!("saf-save-teste-{nome}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&pasta);
            fs::create_dir_all(&pasta).unwrap();
            pasta
        }

        #[test]
        fn pedacos_se_juntam_na_ordem_e_o_primeiro_zera_o_arquivo() {
            let pasta = pasta("pedacos");
            let parcial = pasta.join("saida.pdf.pdfkitty-parcial");
            fs::write(&parcial, b"lixo de uma tentativa anterior").unwrap();

            disk::write_chunk(&parcial, b"%PDF-1.7 ", false).unwrap();
            disk::write_chunk(&parcial, b"meio ", true).unwrap();
            disk::write_chunk(&parcial, b"%%EOF", true).unwrap();

            assert_eq!(fs::read(&parcial).unwrap(), b"%PDF-1.7 meio %%EOF");
            fs::remove_dir_all(pasta).unwrap();
        }

        #[test]
        fn o_temporario_fica_ao_lado_do_destino() {
            let destino = Path::new("C:/pasta/contrato.pdf");
            let parcial = disk::partial_path(destino);
            assert_eq!(parcial.parent(), destino.parent());
            assert_ne!(parcial, destino);
        }

        #[test]
        fn o_destino_so_muda_no_fim_e_entao_e_substituido() {
            let pasta = pasta("fim");
            let destino = pasta.join("contrato.pdf");
            fs::write(&destino, b"versao antiga").unwrap();
            let parcial = disk::partial_path(&destino);

            disk::write_chunk(&parcial, b"versao nova", false).unwrap();
            // Gravacao interrompida aqui deixaria o arquivo do usuario intacto.
            assert_eq!(fs::read(&destino).unwrap(), b"versao antiga");

            disk::finish(&parcial, &destino).unwrap();
            assert_eq!(fs::read(&destino).unwrap(), b"versao nova");
            assert!(!parcial.exists());
            fs::remove_dir_all(pasta).unwrap();
        }

        #[test]
        fn copia_identica_para_outro_destino() {
            let pasta = pasta("copia");
            let origem = pasta.join("a.pdf");
            let destino = pasta.join("b.pdf");
            fs::write(&origem, b"conteudo").unwrap();
            disk::copy(&origem, &destino).unwrap();
            assert_eq!(fs::read(&destino).unwrap(), b"conteudo");
            assert_eq!(fs::read(&origem).unwrap(), b"conteudo");
            fs::remove_dir_all(pasta).unwrap();
        }

        #[test]
        fn copiar_sobre_si_mesmo_nao_zera_a_origem() {
            let pasta = pasta("mesmo");
            let origem = pasta.join("a.pdf");
            fs::write(&origem, b"conteudo").unwrap();
            // Outro caminho para o mesmo arquivo: so a comparacao canonica percebe.
            let outro_caminho = pasta.join(".").join("a.pdf");
            disk::copy(&origem, &outro_caminho).unwrap();
            assert_eq!(fs::read(&origem).unwrap(), b"conteudo");
            fs::remove_dir_all(pasta).unwrap();
        }

        #[test]
        fn origem_que_sumiu_e_erro() {
            let pasta = pasta("sumiu");
            let resultado = disk::copy(&pasta.join("nao-existe.pdf"), &pasta.join("b.pdf"));
            assert!(resultado.is_err());
            fs::remove_dir_all(pasta).unwrap();
        }
    }
}
