

let wsCount = 0

export class WKWebsocket {
    addr!:string
    ws!:WebSocket
    destory:boolean = false
    constructor(addr:string) {
        wsCount++
        this.addr = addr
        this.ws = new WebSocket(this.addr);
        this.ws.binaryType = 'arraybuffer';
    }

    onopen(callback:()=>void) {
        this.ws.onopen = ()=>{
            console.log("onopen---->")
            if(this.destory) {
                return
            }
            if(callback) {
                callback()
            }
        }
    }

    onmessage(callback:((ev: MessageEvent) => any) | null) {
        this.ws.onmessage = (e)=>{
            if(this.destory) {
                return
            }
            if(callback) {
                callback(e.data)
            }
        }
    }

    onclose(callback:(e:CloseEvent)=>void) {
        this.ws.onclose = (e)=>{
            console.log("onclose--->")
            if(this.destory) {
                return
            }
            if(callback) {
                callback(e)
            }
        }
    }

    onerror(callback:(e:Event)=>void) {
        this.ws.onerror = (e)=>{
            console.log("onerror--->")
            if(this.destory) {
                return
            }
            if(callback) {
                callback(e)
            }
        }
    }

    send(data:any) {
        this.ws.send(data)
    }

    close() {
        console.log('close....',wsCount)
        this.destory = true
        this.ws.close()
    }
}