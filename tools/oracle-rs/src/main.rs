use anyhow::{anyhow, Result};
use std::collections::HashMap;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;

// Confirmed by reading references/localsend/core:
// - `LsHttpClientV2` is re-exported from `localsend::http::client` (client/mod.rs: `pub use v2::LsHttpClientV2;`).
// - `ProtocolType` (used as the argument to client methods like `register`/`prepare_upload`/`upload`)
//   lives in `localsend::http::dto` (SCREAMING_SNAKE_CASE serde rename), NOT `dto_v2`.
// - `RegisterDtoV2.protocol` is typed as `ProtocolTypeV2` (from `localsend::http::dto_v2`, lowercase
//   serde rename) -- a *different* enum from `ProtocolType`, despite having the same variant names.
// - `FileDto` lives in `localsend::model::transfer` with `size: u64` (not i64).
// - `DeviceType` lives in `localsend::model::discovery`.
use localsend::http::client::LsHttpClientV2;
use localsend::http::dto::ProtocolType;
use localsend::http::dto_v2::{PrepareUploadRequestDtoV2, ProtocolTypeV2, RegisterDtoV2};
use localsend::model::transfer::FileDto;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let sub = args.get(1).map(|s| s.as_str()).unwrap_or("");
    if sub != "send" {
        return Err(anyhow!(
            "usage: oracle send --host H --port P --file F [--alias A]"
        ));
    }
    let get = |flag: &str| -> Option<String> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let host = get("--host").unwrap_or_else(|| "127.0.0.1".to_string());
    let port: u16 = get("--port").ok_or_else(|| anyhow!("--port required"))?.parse()?;
    let file = get("--file").ok_or_else(|| anyhow!("--file required"))?;
    let alias = get("--alias").unwrap_or_else(|| "Rust Oracle".to_string());

    let file_name = std::path::Path::new(&file)
        .file_name()
        .ok_or_else(|| anyhow!("--file has no file name"))?
        .to_string_lossy()
        .to_string();
    let bytes = tokio::fs::read(&file).await?;
    let size = bytes.len() as u64; // FileDto.size is u64

    let client = LsHttpClientV2::try_new_without_cert()?;

    // Build the sender's device info (RegisterDtoV2's `protocol` field is ProtocolTypeV2,
    // distinct from the ProtocolType used in client method calls below).
    //
    // NOTE: `device_type` is left as `None`. The reference core crate serializes
    // `DeviceType` as SCREAMING_SNAKE_CASE (e.g. "HEADLESS"), but the LocalSend wire
    // protocol (and this repo's TS server) expects lowercase values (e.g. "headless") --
    // see src/protocol/types.ts. Since `device_type` is optional and unused by the
    // receiver's accept/prepare-upload logic, omitting it avoids that reference-crate
    // serde mismatch without touching references/.
    let info = RegisterDtoV2 {
        alias,
        version: "2.1".to_string(),
        device_model: Some("oracle".to_string()),
        device_type: None,
        fingerprint: "oracle-fingerprint".to_string(),
        port: 53318,
        protocol: ProtocolTypeV2::Http,
        download: false,
    };

    let file_id = "oracle-file-1".to_string();
    let file_dto = FileDto {
        id: file_id.clone(),
        file_name: file_name.clone(),
        size,
        file_type: "application/octet-stream".to_string(),
        sha256: None,
        preview: None,
        metadata: None,
    };
    let mut files = HashMap::new();
    files.insert(file_id.clone(), file_dto);

    let payload = PrepareUploadRequestDtoV2 { info, files };

    let prep = client
        .prepare_upload(ProtocolType::Http, &host, port, None, payload, None)
        .await
        .map_err(|e| anyhow!("prepare_upload failed: {e:?}"))?;
    let resp = prep.response.ok_or_else(|| anyhow!("no session (204?)"))?;
    let token = resp
        .files
        .get(&file_id)
        .ok_or_else(|| anyhow!("file not accepted"))?
        .clone();

    // Stream the file bytes over an mpsc channel to upload().
    let (tx, rx) = mpsc::channel::<Vec<u8>>(8);
    let bytes_for_task = bytes.clone();
    tokio::spawn(async move {
        let mut reader = &bytes_for_task[..];
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = reader.read(&mut buf).await.unwrap_or(0);
            if n == 0 {
                break;
            }
            if tx.send(buf[..n].to_vec()).await.is_err() {
                break;
            }
        }
    });

    client
        .upload(
            ProtocolType::Http,
            &host,
            port,
            None,
            &resp.session_id,
            &file_id,
            &token,
            rx,
        )
        .await
        .map_err(|e| anyhow!("upload failed: {e:?}"))?;

    println!("oracle: upload ok ({} bytes) -> {}:{}", size, host, port);
    Ok(())
}
