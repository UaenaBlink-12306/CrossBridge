use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

#[derive(serde::Serialize)]
struct ConnectionStatus {
    mode: &'static str,
    relay_connected: bool,
    lan_connected: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentity {
    device_id: String,
    device_name: String,
    platform: String,
    public_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowsCryptoIdentity {
    identity: DeviceIdentity,
    private_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedDevice {
    device_id: String,
    device_name: String,
    platform: String,
    public_key: String,
    paired_at: u64,
    last_seen_at: Option<u64>,
}

const IDENTITY_FILE_NAME: &str = "windows-identity.json";
const PRIVATE_KEY_FILE_NAME: &str = "windows-private-key.dpapi";
const TRUSTED_DEVICES_FILE_NAME: &str = "trusted-devices.json";

fn storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;
    Ok(dir)
}

fn storage_file(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join(file_name))
}

fn current_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn non_empty_string(value: &Value, field: &str, max_len: usize) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= max_len)
        .map(String::from)
}

fn timestamp(value: &Value, field: &str) -> Option<u64> {
    value.get(field).and_then(Value::as_u64)
}

fn valid_platform(platform: &str) -> bool {
    platform == "windows" || platform == "android"
}

fn identity_from_value(value: &Value) -> Option<DeviceIdentity> {
    let platform = non_empty_string(value, "platform", 32)?;
    if !valid_platform(&platform) {
        return None;
    }

    Some(DeviceIdentity {
        device_id: non_empty_string(value, "deviceId", 128)?,
        device_name: non_empty_string(value, "deviceName", 128)?,
        platform,
        public_key: non_empty_string(value, "publicKey", 512)?,
    })
}

fn trusted_device_from_value(value: &Value) -> Option<TrustedDevice> {
    let identity = identity_from_value(value)?;
    Some(TrustedDevice {
        device_id: identity.device_id,
        device_name: identity.device_name,
        platform: identity.platform,
        public_key: identity.public_key,
        paired_at: timestamp(value, "pairedAt")?,
        last_seen_at: timestamp(value, "lastSeenAt"),
    })
}

fn is_valid_identity(identity: &DeviceIdentity) -> bool {
    !identity.device_id.trim().is_empty()
        && identity.device_id.len() <= 128
        && !identity.device_name.trim().is_empty()
        && identity.device_name.len() <= 128
        && valid_platform(&identity.platform)
        && !identity.public_key.trim().is_empty()
}

fn is_valid_trusted_device(device: &TrustedDevice) -> bool {
    is_valid_identity(&DeviceIdentity {
        device_id: device.device_id.clone(),
        device_name: device.device_name.clone(),
        platform: device.platform.clone(),
        public_key: device.public_key.clone(),
    })
}

fn normalize_trusted_devices(value: Value) -> Vec<TrustedDevice> {
    let mut by_device_id = HashMap::<String, TrustedDevice>::new();
    if let Value::Array(entries) = value {
        for entry in entries {
            if let Some(device) = trusted_device_from_value(&entry) {
                by_device_id.insert(device.device_id.clone(), device);
            }
        }
    }

    let mut devices = by_device_id.into_values().collect::<Vec<_>>();
    devices.sort_by(|left, right| right.paired_at.cmp(&left.paired_at));
    devices
}

fn read_json_file(path: &PathBuf) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_json_file<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize storage JSON: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("Could not write storage JSON: {error}"))
}

#[cfg(target_os = "windows")]
fn protect_secret(plaintext: &str) -> Result<String, String> {
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.as_bytes().len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let description = "CrossBridge Windows private key"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            description.as_ptr(),
            null(),
            null_mut(),
            null(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Could not protect the Windows private key.".into());
    }

    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(encoded)
}

#[cfg(target_os = "windows")]
fn unprotect_secret(protected: &str) -> Result<String, String> {
    let mut protected_bytes = base64::engine::general_purpose::STANDARD
        .decode(protected.trim())
        .map_err(|error| format!("Could not decode protected private key: {error}"))?;
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: protected_bytes.len() as u32,
        pbData: protected_bytes.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            null_mut(),
            null(),
            null_mut(),
            null(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("Could not unprotect the Windows private key.".into());
    }

    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let plaintext = String::from_utf8(bytes.to_vec())
        .map_err(|error| format!("Protected private key was not UTF-8: {error}"))?;
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(plaintext)
}

#[cfg(not(target_os = "windows"))]
fn protect_secret(_plaintext: &str) -> Result<String, String> {
    Err("Protected private key storage is only available on Windows.".into())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_secret(_protected: &str) -> Result<String, String> {
    Err("Protected private key storage is only available on Windows.".into())
}

fn read_trusted_devices(app: &AppHandle) -> Result<Vec<TrustedDevice>, String> {
    let path = storage_file(app, TRUSTED_DEVICES_FILE_NAME)?;
    Ok(read_json_file(&path)
        .map(normalize_trusted_devices)
        .unwrap_or_default())
}

fn create_native_dev_identity() -> DeviceIdentity {
    let now = current_millis();
    DeviceIdentity {
        device_id: format!("pc_native_{now}"),
        device_name: "CrossBridge Windows".into(),
        platform: "windows".into(),
        // Mock public key only. Real key generation and OS-protected private
        // key storage are still pending for a future native security slice.
        public_key: format!("bmF0aXZlLWRldi1wdWJsaWMta2V5{now}"),
    }
}

#[tauri::command]
fn get_or_create_windows_identity(app: AppHandle) -> Result<DeviceIdentity, String> {
    let path = storage_file(&app, IDENTITY_FILE_NAME)?;
    if let Some(value) = read_json_file(&path) {
        if let Some(identity) = identity_from_value(&value) {
            if identity.platform == "windows" {
                return Ok(identity);
            }
        }
    }

    let identity = create_native_dev_identity();
    write_json_file(&path, &identity)?;
    Ok(identity)
}

#[tauri::command]
fn load_windows_crypto_identity(app: AppHandle) -> Result<Option<WindowsCryptoIdentity>, String> {
    let identity_path = storage_file(&app, IDENTITY_FILE_NAME)?;
    let private_key_path = storage_file(&app, PRIVATE_KEY_FILE_NAME)?;
    let identity = read_json_file(&identity_path)
        .and_then(|value| identity_from_value(&value))
        .filter(|identity| identity.platform == "windows");
    let protected_private_key = fs::read_to_string(private_key_path).ok();

    match (identity, protected_private_key) {
        (Some(identity), Some(protected_private_key)) => Ok(Some(WindowsCryptoIdentity {
            identity,
            private_key: unprotect_secret(&protected_private_key)?,
        })),
        _ => Ok(None),
    }
}

#[tauri::command]
fn save_windows_crypto_identity(
    app: AppHandle,
    identity: DeviceIdentity,
    private_key: String,
) -> Result<(), String> {
    if identity.platform != "windows" || !is_valid_identity(&identity) || private_key.trim().is_empty() {
        return Err("Windows crypto identity payload is invalid.".into());
    }

    let identity_path = storage_file(&app, IDENTITY_FILE_NAME)?;
    let private_key_path = storage_file(&app, PRIVATE_KEY_FILE_NAME)?;
    write_json_file(&identity_path, &identity)?;
    fs::write(private_key_path, protect_secret(&private_key)?)
        .map_err(|error| format!("Could not write protected Windows private key: {error}"))
}

#[tauri::command]
fn reset_windows_identity_for_dev_only(app: AppHandle) -> Result<(), String> {
    let path = storage_file(&app, IDENTITY_FILE_NAME)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not remove Windows identity: {error}"))?;
    }
    let private_key_path = storage_file(&app, PRIVATE_KEY_FILE_NAME)?;
    if private_key_path.exists() {
        fs::remove_file(private_key_path)
            .map_err(|error| format!("Could not remove Windows private key: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn load_trusted_devices(app: AppHandle) -> Result<Vec<TrustedDevice>, String> {
    read_trusted_devices(&app)
}

#[tauri::command]
fn save_trusted_device(app: AppHandle, device: TrustedDevice) -> Result<(), String> {
    if !is_valid_trusted_device(&device) {
        return Err("Trusted device payload is invalid.".into());
    }

    let path = storage_file(&app, TRUSTED_DEVICES_FILE_NAME)?;
    let mut devices = read_trusted_devices(&app)?;
    let existing = devices
        .iter()
        .find(|entry| entry.device_id == device.device_id);
    let mut saved_device = device.clone();
    if existing.is_some() && saved_device.last_seen_at.is_none() {
        saved_device.last_seen_at = Some(current_millis());
    }

    devices.retain(|entry| entry.device_id != saved_device.device_id);
    devices.push(saved_device);
    devices.sort_by(|left, right| right.paired_at.cmp(&left.paired_at));
    write_json_file(&path, &devices)
}

#[tauri::command]
fn remove_trusted_device(app: AppHandle, device_id: String) -> Result<(), String> {
    let path = storage_file(&app, TRUSTED_DEVICES_FILE_NAME)?;
    let mut devices = read_trusted_devices(&app)?;
    devices.retain(|device| device.device_id != device_id);
    write_json_file(&path, &devices)
}

#[tauri::command]
fn clear_trusted_devices(app: AppHandle) -> Result<(), String> {
    let path = storage_file(&app, TRUSTED_DEVICES_FILE_NAME)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Could not remove trusted devices: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn pair_device() -> &'static str {
    "Pairing starts in Milestone 3."
}

#[tauri::command]
fn send_file() -> &'static str {
    "File transfer starts in Milestone 7."
}

#[tauri::command]
fn send_text() -> &'static str {
    "Text sharing starts in Milestone 6."
}

#[tauri::command]
fn get_devices() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
fn get_connection_status() -> ConnectionStatus {
    ConnectionStatus {
        mode: "DISCONNECTED",
        relay_connected: false,
        lan_connected: false,
    }
}

#[tauri::command]
fn update_settings() -> bool {
    true
}

#[tauri::command]
fn dismiss_notification() -> &'static str {
    "Notification actions start in Milestone 9."
}

#[tauri::command]
fn reply_notification() -> &'static str {
    "Notification actions start in Milestone 9."
}

struct TrayMenuState {
    status_item: tauri::menu::MenuItem<tauri::Wry>,
}

#[tauri::command]
fn update_tray_status(
    state: tauri::State<'_, TrayMenuState>,
    status: String,
) -> Result<(), String> {
    state.status_item.set_text(format!("Status: {status}")).map_err(|e| e.to_string())
}

fn start_probe_server(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let listener = match std::net::TcpListener::bind("0.0.0.0:8789") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[CrossBridge LAN Probe] Failed to bind TCP listener to port 8789: {}", e);
                return;
            }
        };

        println!("[CrossBridge LAN Probe] TCP listener running on port 8789");
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let app_clone = app.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = handle_probe_or_transfer(app_clone, stream) {
                            eprintln!("[CrossBridge LAN Probe] Connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    eprintln!("[CrossBridge LAN Probe] Incoming stream error: {}", e);
                }
            }
        }
    });
}

fn handle_probe_or_transfer(app: tauri::AppHandle, mut stream: std::net::TcpStream) -> Result<(), String> {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::time::Duration;

    // Set read timeout to 200ms to quickly detect if the client is just probing
    stream.set_read_timeout(Some(Duration::from_millis(200))).map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut first_line = String::new();
    
    let is_handshake = match reader.read_line(&mut first_line) {
        Ok(n) if n > 0 => {
            first_line.trim().starts_with("CROSSBRIDGE_FILE_HANDSHAKE:")
        }
        _ => false,
    };

    if !is_handshake {
        // Fall back to the traditional LAN discovery probe behavior
        let _ = stream.write_all(b"CROSSBRIDGE_PROBE_ACK\n");
        let _ = stream.flush();
        return Ok(());
    }

    // Reset read timeout for direct file transfer
    stream.set_read_timeout(None).map_err(|e| e.to_string())?;

    let handshake_payload = first_line.trim().trim_start_matches("CROSSBRIDGE_FILE_HANDSHAKE:");
    let handshake: serde_json::Value = serde_json::from_str(handshake_payload).map_err(|e| e.to_string())?;
    
    let transfer_id = handshake.get("transferId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing transferId in handshake".to_string())?
        .to_string();
        
    let mode = handshake.get("mode")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing mode in handshake".to_string())?;

    if mode == "send" {
        // Android is sending file chunk envelopes over TCP
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            let _ = app.emit("lan-chunk-received", value);
                        }
                    }
                }
                Err(e) => {
                    return Err(format!("Error reading LAN stream: {}", e));
                }
            }
        }
    } else if mode == "receive" {
        // Android is waiting to receive file chunk envelopes over TCP
        let state = app.state::<FileTransferState>();
        let stream_clone = stream.try_clone().map_err(|e| e.to_string())?;
        {
            let mut receivers = state.active_receivers.lock().map_err(|e| e.to_string())?;
            receivers.insert(transfer_id.clone(), stream_clone);
        }
        
        let _ = app.emit("lan-receiver-connected", transfer_id.clone());
        
        // Wait here reading dummy bytes to keep the thread alive and detect socket closing
        let mut buffer = [0u8; 128];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(_) => {}
                Err(_) => break,
            }
        }
        
        {
            let state = app.state::<FileTransferState>();
            if let Ok(mut receivers) = state.active_receivers.lock() {
                receivers.remove(&transfer_id);
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_local_ips() -> Vec<String> {
    let mut ips = Vec::new();

    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                ips.push(addr.ip().to_string());
            }
        }
    }

    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }

    ips
}

struct FileTransferState {
    active_receivers: Mutex<HashMap<String, TcpStream>>,
}

#[tauri::command]
fn send_lan_file_chunk(
    state: tauri::State<'_, FileTransferState>,
    transfer_id: String,
    envelope_json: String,
) -> Result<(), String> {
    let mut receivers = state.active_receivers.lock().map_err(|e| e.to_string())?;
    if let Some(stream) = receivers.get_mut(&transfer_id) {
        let mut data = envelope_json.as_bytes().to_vec();
        data.push(b'\n');
        stream.write_all(&data).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No active direct TCP socket receiver for this transfer ID.".into())
    }
}

#[tauri::command]
fn close_lan_file_receiver(
    state: tauri::State<'_, FileTransferState>,
    transfer_id: String,
) -> Result<(), String> {
    let mut receivers = state.active_receivers.lock().map_err(|e| e.to_string())?;
    if let Some(stream) = receivers.remove(&transfer_id) {
        drop(stream);
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let open_i = tauri::menu::MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let reconnect_i = tauri::menu::MenuItem::with_id(app, "reconnect", "Reconnect", true, None::<&str>)?;
            let status_i = tauri::menu::MenuItem::with_id(app, "status", "Status: Disconnected", false, None::<&str>)?;

            let menu = tauri::menu::MenuBuilder::new(app)
                .item(&status_i)
                .item(&reconnect_i)
                .separator()
                .item(&open_i)
                .item(&quit_i)
                .build()?;

            app.manage(TrayMenuState {
                status_item: status_i.clone(),
            });

            // Initialize and register direct file transfer state
            app.manage(FileTransferState {
                active_receivers: Mutex::new(HashMap::new()),
            });

            // Start the LAN discovery probe server on port 8789
            let app_handle = app.handle().clone();
            start_probe_server(app_handle);

            let _tray = tauri::tray::TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "reconnect" => {
                            let _ = app.emit("tray-reconnect", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            tauri::WindowEvent::Resized(_) => {
                if let Ok(true) = window.is_minimized() {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_or_create_windows_identity,
            load_windows_crypto_identity,
            save_windows_crypto_identity,
            reset_windows_identity_for_dev_only,
            load_trusted_devices,
            save_trusted_device,
            remove_trusted_device,
            clear_trusted_devices,
            pair_device,
            send_file,
            send_text,
            get_devices,
            get_connection_status,
            update_settings,
            dismiss_notification,
            reply_notification,
            update_tray_status,
            get_local_ips,
            send_lan_file_chunk,
            close_lan_file_receiver
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrossBridge");
}

