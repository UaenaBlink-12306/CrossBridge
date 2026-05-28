const { execSync } = require('child_process');

const adb = '"C:\\Users\\alpac\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe"';

const payload = {
  "protocol": "crossbridge-v1",
  "pairingSessionId": "pair_0d90aa45a59f43519aaab306",
  "relayUrl": "ws://10.0.2.2:8787/connect",
  "pcDeviceId": "windows_dev_test_id",
  "pcDeviceName": "Dev Windows PC",
  "pcPublicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEndBVRrbzr3bAS87Y14yha65wx758v0XJTw7pyH3lInRks0HaLRX7/uv78e8+hsn8n6NbTqPpigOF+adWeaOGng==",
  "pairingToken": "Pt6ST_ywN-EFyvg3eUMZ6mAR",
  "expiresAt": 1779613956978
};

const payloadStr = JSON.stringify(payload);

console.log("Clearing input field...");
execSync(`${adb} shell input keyevent KEYCODE_MOVE_END`);
execSync(`${adb} shell input keyevent --longpress KEYCODE_SHIFT_LEFT KEYCODE_MOVE_HOME`);
execSync(`${adb} shell input keyevent KEYCODE_DEL`);

console.log("Typing payload JSON...");
// Escape double quotes and other special shell chars
const escaped = payloadStr.replace(/([\\"$`])/g, '\\$1');
execSync(`${adb} shell input text "${escaped}"`);
console.log("Successfully typed QR JSON!");
