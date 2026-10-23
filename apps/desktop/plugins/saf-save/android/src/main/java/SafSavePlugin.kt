package com.pdfkitty.safsave

import android.app.Activity
import android.net.Uri
import android.provider.DocumentsContract
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.io.IOException

@InvokeArg
class CopyToUriArgs {
    lateinit var source: String
    lateinit var destination: String
}

@InvokeArg
class CopySavedArgs {
    lateinit var source: String
    lateinit var destination: String
}

@InvokeArg
class DiscardUriArgs {
    lateinit var destination: String
}

/**
 * Copia um arquivo do cache do app para o documento que o usuario escolheu no seletor.
 *
 * A gravacao passa pelo `OutputStream` do content resolver e o stream e FECHADO por ele. Esse
 * fechamento e o evento que faz o provedor de documentos do Android atualizar o tamanho do
 * arquivo — e e exatamente o que falta no `tauri-plugin-fs`, que pede um descritor cru
 * (`parcelFileDescriptor.detachFd()`) e o fecha do lado do Rust. Ali o provedor nunca sabe que
 * a gravacao terminou, e o documento continua registrado com zero bytes: o arquivo fica no
 * disco, mas ilegivel para qualquer aplicativo que o abra pelo caminho normal.
 *
 * O modo "wt" (write + truncate) importa: sem o truncate, sobrescrever um documento menor
 * deixaria sobras do conteudo anterior no fim do arquivo.
 */
@TauriPlugin
class SafSavePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun copyToUri(invoke: Invoke) {
        val args = invoke.parseArgs(CopyToUriArgs::class.java)

        try {
            FileInputStream(File(args.source)).use { entrada ->
                val saida = activity.contentResolver.openOutputStream(Uri.parse(args.destination), "wt")
                    ?: throw IOException("nao foi possivel abrir o destino para escrita")

                saida.use { destino ->
                    entrada.copyTo(destino)
                    destino.flush()
                }
            }
            invoke.resolve()
        } catch (erro: Exception) {
            invoke.reject(erro.message ?: "falha ao gravar no destino escolhido")
        }
    }

    /**
     * Copia um documento ja salvo para um novo destino: o "salvar de novo".
     *
     * Existe para a interface nao manter o arquivo gerado na memoria. A permissao de leitura
     * da origem vale enquanto o processo do app viver, e o "salvar de novo" so existe nesse
     * intervalo: depois de reiniciar, nao ha ultima geracao a reoferecer.
     *
     * Origem igual ao destino nao faz nada: abrir o destino em "wt" trunca, e sendo o mesmo
     * documento, a origem seria zerada antes de ser lida.
     */
    @Command
    fun copySaved(invoke: Invoke) {
        val args = invoke.parseArgs(CopySavedArgs::class.java)

        if (args.source == args.destination) {
            invoke.resolve()
            return
        }

        try {
            val entrada = activity.contentResolver.openInputStream(Uri.parse(args.source))
                ?: throw IOException("nao foi possivel ler o arquivo salvo")

            entrada.use { origem ->
                val saida = activity.contentResolver.openOutputStream(Uri.parse(args.destination), "wt")
                    ?: throw IOException("nao foi possivel abrir o destino para escrita")

                saida.use { destino ->
                    origem.copyTo(destino)
                    destino.flush()
                }
            }
            invoke.resolve()
        } catch (erro: Exception) {
            invoke.reject(erro.message ?: "falha ao copiar o arquivo salvo")
        }
    }

    /**
     * Apaga um documento que ficou vazio porque a geracao falhou.
     *
     * O seletor cria o documento assim que o usuario confirma o nome, antes de existir
     * qualquer byte. Sem isto, uma geracao que falha deixa um arquivo de 0 bytes na pasta do
     * usuario — e um arquivo de 0 bytes e exatamente o sintoma do defeito que este plugin
     * existe para corrigir, o que tornaria o diagnostico futuro confuso.
     */
    @Command
    fun discardUri(invoke: Invoke) {
        val args = invoke.parseArgs(DiscardUriArgs::class.java)

        try {
            DocumentsContract.deleteDocument(activity.contentResolver, Uri.parse(args.destination))
            invoke.resolve()
        } catch (erro: Exception) {
            // Nao conseguir apagar nao pode derrubar o fluxo de erro que trouxe ate aqui: o
            // usuario ja vai receber a mensagem da falha real da geracao.
            invoke.reject(erro.message ?: "falha ao descartar o destino")
        }
    }
}
