import { Message } from "./model"


type TaskListener = () => void
type TaskManagerListener = (task:Task) => void

export enum TaskStatus {
    wait, // 等待上传或下载
    success, // 成功
    processing, // 处理中
    fail, // 失败
    suspend, // 挂起
    cancel, // 取消
}

export class TaskManager {
    private taskMap: Map<string, Task> = new Map()
    private listeners:TaskManagerListener[] = new Array<TaskManagerListener>()

    addTask(task: Task) {
        this.taskMap.set(task.id, task)

        task.addListener(()=>{
            this.notifyListeners(task)
        })
        task.start()
    }
    removeTask(id: string) {
        const task = this.taskMap.get(id)
        if (task) {
            task.cancel()
            this.taskMap.delete(id)
        }
    }
    addListener(listener: TaskManagerListener): void {
        this.listeners.push(listener)
    }
    removeListener(listener: TaskManagerListener): void {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return;
            }
        }
    }
    notifyListeners(task:Task) {
        if (this.listeners) {
            this.listeners.forEach((callback) => {
                callback(task);
            });
        }
    }
}

export interface Task {
    id: string
    status: TaskStatus
    start(): void
    suspend(): void // 挂起任务
    resume(): void // 恢复任务
    cancel(): void // 取消任务
    update(): void // 更新任务
    progress(): number // 获取任务进度

    addListener(listener: TaskListener): void
    removeListener(listener: TaskListener): void
}



export class BaseTask implements Task {
    id!: string;
    status!: TaskStatus;
    private _listeners!: TaskListener[]
     // tslint:disable-next-line:no-empty
    start(): void {

    }
     // tslint:disable-next-line:no-empty
    suspend(): void {

    }
     // tslint:disable-next-line:no-empty
    resume(): void {

    }
     // tslint:disable-next-line:no-empty
    cancel(): void {

    }
    update(): void {
        if (this.listeners) {
            this.listeners.forEach((callback) => {
                callback();
            });
        }
    }
    progress(): number {
        return 0
    }
    addListener(listener: TaskListener): void {
        this.listeners.push(listener)
    }
    removeListener(listener: TaskListener): void {
        const len = this.listeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.listeners[i]) {
                this.listeners.splice(i, 1)
                return;
            }
        }
    }

    public get listeners(): TaskListener[]{
        if (!this._listeners) {
            this._listeners = new Array<TaskListener>()
        }
        return this._listeners
    }

}


export class MessageTask extends BaseTask {
    message: Message
    constructor(message:Message) {
        super()
        this.id = message.clientMsgNo
        this.message = message
    }
}