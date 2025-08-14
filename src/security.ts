
import CryptoJS from 'crypto-js';
// import { StorageType, Direction,PreKeyType, SessionRecordType, SignalProtocolAddress, PreKeyPairType, KeyPairType, SignedPreKeyPairType, KeyHelper, SessionBuilder, SessionCipher, DeviceType, SignedPublicPreKeyType } from '@privacyresearch/libsignal-protocol-typescript';
import * as buffer from "buffer";
export class SecurityManager {

    aesKey!: string // 消息加解密的aes key
    aesIV!: string // 消息aes iv
    registrationID!: number // 注册ID
    // store!: SignalProtocolStore
    deviceID: number = 2
    private static instance: SecurityManager
    public static shared() {
        if (!this.instance) {
            this.instance = new SecurityManager();
            // this.instance.store = new SignalProtocolStore()
        }
        return this.instance;
    }
    private constructor() {

    }

    // public set identityKey(identityKeyPair: KeyPairType<ArrayBuffer> | undefined) {
    //     this.store.put("identityKey", identityKeyPair)
    // }


    // public async initSignal() {
    //     const registrationId = KeyHelper.generateRegistrationId();
    //     this.registrationID = registrationId
    //     this.store.put("registrationId", registrationId)

    //     const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
    //     this.store.put("identityKey", identityKeyPair)
    // }

    // public async generateSignedPreKey() {
    //     const identityKeyPair = await this.store.getIdentityKeyPair()
    //     const signedPreKeyId = Math.floor(10000 * Math.random());
    //     const signedPreKey = await KeyHelper.generateSignedPreKey(
    //         identityKeyPair!,
    //         signedPreKeyId
    //     );
    //     this.store.storeSignedPreKey(signedPreKeyId, signedPreKey.keyPair);

    //     const publicSignedPreKey: SignedPublicPreKeyType = {
    //         keyId: signedPreKeyId,
    //         publicKey: signedPreKey.keyPair.pubKey,
    //         signature: signedPreKey.signature,
    //       };

    //     return publicSignedPreKey
    // }

    // public async generatePreKeys() :Promise<PreKeyType[]> {
    //     const baseKeyId = Math.floor(10000 * Math.random());
    //     const  publicPreKey1  = await this.generatePreKey(baseKeyId)
    //     const  publicPreKey2  = await this.generatePreKey(baseKeyId+1)
    //     return [publicPreKey1,publicPreKey2]
        
    // }

    // public async generatePreKey(keyID:number) {
    //     const preKey = await KeyHelper.generatePreKey(keyID);
    //     this.store.storePreKey(`${keyID}`, preKey.keyPair);

    //     const publicPreKey: PreKeyType = {
    //         keyId: preKey.keyId,
    //         publicKey: preKey.keyPair.pubKey,
    //       };
    //       return publicPreKey
    // }

    // public async signalDecrypt(recipientID: string, messageData: Uint8Array): Promise<ArrayBuffer> {
    //     // const recipientAddress = new SignalProtocolAddress(recipientID, this.deviceID);

    //     // const cipher = new SessionCipher(this.store, recipientAddress);

    //     // let type = messageData[0]
    //     // let message = messageData.subarray(1)

    //     // const encodedString = uint8ArrayToString(message)

    //     // console.log('type--->',type)
    //     // let messageBuff = Uint8Array.from(Buffer.from(encodedString, "base64")).buffer
    //     // if (type === 3) {

    //     //     return cipher.decryptPreKeyWhisperMessage(messageBuff)
    //     // }
    //     // return cipher.decryptWhisperMessage(messageBuff)

    //     return messageData.buffer
    // }

    public async signalEncrypt(recipientID: string, contentData: Uint8Array) {
        // const recipientAddress = new SignalProtocolAddress(recipientID, this.deviceID);
        // const cipher = new SessionCipher(this.store, recipientAddress);

        // const message = await cipher.encrypt(contentData.buffer)
        // const messageBase64 = Buffer.from(this.stringToUint(message.body ?? "")).toString("base64")
        // const messageUint8s = this.stringToUint(messageBase64)


        // return Uint8Array.from([message.type, ...messageUint8s])

        return contentData
    }

    // public async signalProcessSession(recipientID: string, deviceType: DeviceType) {
    //     const recipientAddress = new SignalProtocolAddress(recipientID, this.deviceID);
    //     const sessionBuilder = new SessionBuilder(this.store, recipientAddress);
    //     const session = await sessionBuilder.processPreKey(deviceType)
    //     return session
    // }

    public stringToUint(str: string): number[] {
        // let string = unescape(encodeURIComponent(str));
        const charList = str.split('');
        const uintArray = new Array<number>();
        for (const v of charList) {
            uintArray.push(v.charCodeAt(0));
        }
        return uintArray;
    }

    public encryption(message: string) {

        const actMsgKeyBytes = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(message), CryptoJS.enc.Utf8.parse(this.aesKey), {
            keySize: 128 / 8,
            iv: CryptoJS.enc.Utf8.parse(this.aesIV),
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        })
        const actMsgKey = actMsgKeyBytes.toString()
        return actMsgKey
    }

    public decryption(message: Uint8Array) {
        const messageStr = this.uintToString(Array.from(message))
        const messagedecBase64 = CryptoJS.enc.Base64.parse(messageStr)
        const decrypted = CryptoJS.AES.decrypt(CryptoJS.enc.Base64.stringify(messagedecBase64), CryptoJS.enc.Utf8.parse(this.aesKey), {
            keySize: 128 / 8,
            iv: CryptoJS.enc.Utf8.parse(this.aesIV),
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        })
        return Uint8Array.from(buffer.Buffer.from(decrypted.toString(CryptoJS.enc.Utf8)))

    }

    public encryption2(message: Uint8Array) {
        const encodedString = String.fromCharCode.apply(null, Array.from(message));
        const decodedString = decodeURIComponent(escape(encodedString));
        return this.encryption(decodedString)
    }
    public uintToString(array: any[]): string {
        const encodedString = String.fromCharCode.apply(null, array);
        // const decodedString = decodeURIComponent(escape(encodedString));
        return encodedString;
    }

}


// // Type guards
// export function isKeyPairType(kp: any): kp is KeyPairType {
//     return !!(kp?.privKey && kp?.pubKey)
// }

// export function isPreKeyType(pk: any): pk is PreKeyPairType {
//     return typeof pk?.keyId === 'number' && isKeyPairType(pk?.keyPair)
// }

// export function isSignedPreKeyType(spk: any): spk is SignedPreKeyPairType {
//     return spk?.signature && isPreKeyType(spk)
// }


// interface SignedPreKeyType extends PreKeyType {
//     signature: ArrayBuffer
// }



// // interface PreKeyType {
// //     keyId: number
// //     keyPair: KeyPairType
// // }

// type StoreValue = KeyPairType | string | number | KeyPairType | PreKeyType | SignedPreKeyType | ArrayBuffer | undefined

// function isArrayBuffer(thing: StoreValue): boolean {
//     const t = typeof thing
//     return !!thing && t !== 'string' && t !== 'number' && 'byteLength' in (thing as any)
// }

// class SignalProtocolStore implements StorageType {
//     private _store: Record<string, StoreValue>
//     constructor() {
//         this._store = {}
//     }
//     get(key: string, defaultValue: StoreValue): StoreValue {
//         if (key === null || key === undefined) throw new Error('Tried to get value for undefined/null key')
//         if (key in this._store) {
//             return this._store[key]
//         } else {
//             return defaultValue
//         }
//     }
//     remove(key: string): void {
//         if (key === null || key === undefined) throw new Error('Tried to remove value for undefined/null key')
//         delete this._store[key]
//     }
//     put(key: string, value: StoreValue): void {
//         if (key === undefined || value === undefined || key === null || value === null)
//             throw new Error('Tried to store undefined/null')
//         this._store[key] = value
//     }

//     async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
//         console.log('getIdentityKeyPair-->')
//         const kp = this.get('identityKey', undefined)
//         if (isKeyPairType(kp) || typeof kp === 'undefined') {
//             return kp
//         }
//         throw new Error('Item stored as identity key of unknown type.')
//     }
//     async getLocalRegistrationId(): Promise<number | undefined> {
//         console.log('getLocalRegistrationId-->')
//         const rid = this.get('registrationId', undefined)
//         if (typeof rid === 'number' || typeof rid === 'undefined') {
//             return rid
//         }
//         throw new Error('Stored Registration ID is not a number')
//     }
//     async isTrustedIdentity(
//         identifier: string,
//         identityKey: ArrayBuffer,
//         // eslint-disable-next-line @typescript-eslint/no-unused-vars
//         _direction: Direction
//     ): Promise<boolean> {
//         console.log('isTrustedIdentity-->', identifier)
//         if (identifier === null || identifier === undefined) {
//             throw new Error('tried to check identity key for undefined/null key')
//         }
//         const trusted = this.get('identityKey' + identifier, undefined)

//         // TODO: Is this right? If the ID is NOT in our store we trust it?
//         if (trusted === undefined) {
//             return Promise.resolve(true)
//         }
//         return Promise.resolve(
//             arrayBufferToString(identityKey) === arrayBufferToString(trusted as ArrayBuffer)
//         )
//     }
//     async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
//         console.log('saveIdentity-->', identifier)
//         if (identifier === null || identifier === undefined)
//             throw new Error('Tried to put identity key for undefined/null key')

//         const address = SignalProtocolAddress.fromString(identifier)

//         const existing = this.get('identityKey' + address.getName(), undefined)
//         this.put('identityKey' + address.getName(), identityKey)
//         if (existing && !isArrayBuffer(existing)) {
//             throw new Error('Identity Key is incorrect type')
//         }

//         if (existing && arrayBufferToString(identityKey) !== arrayBufferToString(existing as ArrayBuffer)) {
//             return true
//         } else {
//             return false
//         }
//     }
    // async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    //     console.log('loadPreKey-->', keyId)
    //     let res = this.get('25519KeypreKey' + keyId, undefined)
    //     if (isKeyPairType(res)) {
    //         res = { pubKey: res.pubKey, privKey: res.privKey }
    //         return res
    //     } else if (typeof res === 'undefined') {
    //         return res
    //     }
    //     throw new Error(`stored key has wrong type`)
    // }
    // async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    //     console.log('storePreKey-->', keyId)
    //     return this.put('25519KeypreKey' + keyId, keyPair)
    // }
    // async removePreKey(keyId: number | string): Promise<void> {
    //     console.log('removePreKey-->', keyId)
    //     this.remove('25519KeypreKey' + keyId)
    // }
    // async storeSession(identifier: string, record: SessionRecordType): Promise<void> {
    //     console.log('storeSession--->', identifier)
    //     return this.put('session' + identifier, record)
    // }
    // async loadSession(identifier: string): Promise<SessionRecordType | undefined> {
    //     console.log('loadSession--->', identifier)
    //     const rec = this.get('session' + identifier, undefined)
    //     if (typeof rec === 'string') {
    //         return rec as string
    //     } else if (typeof rec === 'undefined') {
    //         return rec
    //     }
    //     throw new Error(`session record is not an ArrayBuffer`)
    // }
    // async hasSession(identifier: string): Promise<boolean> {
    //     const session = await this.loadSession(identifier)
    //     if (session) {
    //         return true
    //     }
    //     return false
    // }
    // async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    //     console.log('loadSignedPreKey-->', keyId)
    //     const res = this.get('25519KeysignedKey' + keyId, undefined)
    //     if (isKeyPairType(res)) {
    //         return { pubKey: res.pubKey, privKey: res.privKey }
    //     } else if (typeof res === 'undefined') {
    //         return res
    //     }
    //     throw new Error(`stored key has wrong type`)
    // }
    // // TODO: Why is this keyId a number where others are strings?
    // async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    //     console.log('storeSignedPreKey-->', keyId)
    //     return this.put('25519KeysignedKey' + keyId, keyPair)
    // }
    // async removeSignedPreKey(keyId: number | string): Promise<void> {
    //     console.log('removeSignedPreKey-->', keyId)
    //     return this.remove('25519KeysignedKey' + keyId)
    // }

    // async removeSession(identifier: string): Promise<void> {
    //     console.log('removeSession-->', identifier)
    //     return this.remove('session' + identifier)
    // }
    // async removeAllSessions(identifier: string): Promise<void> {
    //     console.log('removeAllSessions-->', identifier)
    //     for (const id in this._store) {
    //         if (id.startsWith('session' + identifier)) {
    //             delete this._store[id]
    //         }
    //     }
    // }

// }

export function arrayBufferToString(b: ArrayBuffer): string {
    return uint8ArrayToString(new Uint8Array(b))
}

export function uint8ArrayToString(arr: Uint8Array): string {
    const end = arr.length
    let begin = 0
    if (begin === end) return ''
    let chars: number[] = []
    const parts: string[] = []
    while (begin < end) {
        chars.push(arr[begin++])
        if (chars.length >= 1024) {
            parts.push(String.fromCharCode(...chars))
            chars = []
        }
    }
    return parts.join('') + String.fromCharCode(...chars)
}