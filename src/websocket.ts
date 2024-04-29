


// const platformObj: any = getPlatformObj() // 获取平台全局操作对象

declare const uni: any; // 定义uni 为全局对象
declare const wx: any; // 定义wx为全局对象

let wkconnectSocket:any

function getPlatformObj() {
    if (typeof uni !== 'undefined') {
        console.log('UniApp运行环境');
        wkconnectSocket = uni.connectSocket
        return uni
    } else if (typeof wx !== 'undefined') {
        console.log('小程序运行环境');
        wkconnectSocket = wx.connectSocket
        return wx
    } else {
        console.log('web运行环境');
        return undefined
    }
}

export class WKWebsocket {
    addr!: string
    ws!: WebSocket | any
    destory: boolean = false
    platform:any
    constructor(addr: string,platform?:any) {
        this.addr = addr

        if(platform) {
            this.platform = platform
        }else {
            this.platform = getPlatformObj()
        }
        if(wkconnectSocket) {
           this.ws = wkconnectSocket({
                url: addr,
                success: ()=> {
                    console.log('打开websocket成功')
                },
                fail: ()=> {
                    console.log('打开websocket失败')
                },
                complete: ()=> {
                    // eslint-disable-next-line no-empty-function
                } // TODO: 这里一定要写，不然会返回一个 Promise对象
            })
        }else{
            console.log('使用原生websocket')
            this.ws = new WebSocket(this.addr);
            this.ws.binaryType = 'arraybuffer';
        }
        console.log('websocket', this.ws)
       
    }

    onopen(callback: () => void) {
        if (this.platform) {
            this.ws.onOpen(() => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback()
                }
            })
        } else {
            this.ws.onopen = () => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback()
                }
            }
        }
    }

    onmessage(callback: ((ev: MessageEvent) => any) | null) {
        if (this.platform) {
            this.ws.onMessage((e:any) => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback(e.data)
                }
            })
        } else {
            this.ws.onmessage = (e:any) => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback(e.data)
                }
            }
        }

    }

    onclose(callback: (e: CloseEvent) => void) {
        if (this.platform) {
            this.ws.onClose((params:any) => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback(params)
                }
            })
        } else {
            this.ws.onclose = (e:any) => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback(e)
                }
            }
        }

    }

    onerror(callback: (e: Event) => void) {
        if (this.platform) {
            this.ws.onError((e:any) => {
                if (callback) {
                    callback(e)
                }
            })
        } else {
            this.ws.onerror = (e:any) => {
                if (this.destory) {
                    return
                }
                if (callback) {
                    callback(e)
                }
            }
        }
    }

    send(data: any) {
        if (this.platform) {
            if(data instanceof Uint8Array) {
                this.ws.send({ data:data.buffer })
            }else {
                this.ws.send({ data })
            }
            
        } else {
            if (this.ws.readyState !== WebSocket.OPEN) {
                console.log('ws尚未连接，无法发送消息: ', this.ws.readyState)
                return
            }
            this.ws.send(data)
        }

    }

    close() {
        this.destory = true
        this.ws.close()
    }
}