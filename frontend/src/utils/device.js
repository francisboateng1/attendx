const DEVICE_KEY_STORAGE_NAME = 'attendxDeviceKey';

// A persistent browser identifier for prototype-level duplicate-device checks.
// It is not hardware attestation and can be bypassed by clearing browser storage.
export function getDeviceKey() {
    let deviceKey = localStorage.getItem(DEVICE_KEY_STORAGE_NAME);
    if (!deviceKey) {
        if (!globalThis.crypto?.randomUUID) throw new Error('This browser cannot generate a secure device identifier.');
        deviceKey = globalThis.crypto.randomUUID();
        localStorage.setItem(DEVICE_KEY_STORAGE_NAME, deviceKey);
    }
    return deviceKey;
}
