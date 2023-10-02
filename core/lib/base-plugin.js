"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasePlugin = exports.EventEmitter = void 0;
const express_1 = __importDefault(require("express"));
const ws_1 = __importDefault(require("ws"));
;
;
/**
 * Handles emitting events (like logs and results) via the websocket connection
 */
class EventEmitter {
    constructor(conn) {
        this.conn = conn;
    }
    /**
     * Sends verbose output to the client which is displayed when
     * running commands using the verbose flag.
     */
    log(message) {
        this.conn.send(JSON.stringify({
            verboseOutput: message
        }));
    }
    /**
     * Sends an error to the client. This will cause the connection to
     * be closed and further commands won't be received.
     */
    error(message) {
        this.conn.send(JSON.stringify({
            error: message
        }));
    }
    /**
     * Sends the build output to the client.
     * @param image_digest Image digest of the built image used to run the Apply step
     */
    buildOutput(image_digest) {
        this.conn.send(JSON.stringify({
            result: {
                image: image_digest,
            },
        }));
    }
    /**
     * Sends the apply output to the client.
     * @param state Resulting state to store
     * @param outputs Datacenter outputs from the execution of this module
     */
    applyOutput(state, outputs) {
        this.conn.send(JSON.stringify({
            result: {
                state,
                outputs,
            }
        }));
    }
}
exports.EventEmitter = EventEmitter;
class BasePlugin {
    /**
     * Run this module. This method creates an express application
     * and configures the WebSocket server with path `/ws` to handle
     * 'build' and 'apply' commands.
     *
     * The express server is started on `process.env.PORT`, defaulting
     * to port 50051.
     */
    run() {
        const app = (0, express_1.default)();
        const server_port = process.env.PORT || 50051;
        const websocketServer = new ws_1.default.Server({
            noServer: true,
            path: '/ws',
        });
        const server = app.listen(server_port, () => {
            console.log(`Started server on port ${server_port}`);
        });
        server.on('upgrade', (request, socket, head) => {
            websocketServer.handleUpgrade(request, socket, head, (websocket) => {
                websocketServer.emit('connection', websocket, request);
            });
        });
        websocketServer.on('connection', (conn, _req) => {
            conn.on('message', (message) => {
                const ws_message = JSON.parse(message.toString());
                // Construct an emitter so that Module impls don't need to
                // interact directly with the WebSocket connection.
                const emitter = new EventEmitter(conn);
                if (ws_message.command) {
                    if (ws_message.command === 'build') {
                        this.build(emitter, ws_message.request);
                    }
                    else if (ws_message.command === 'apply') {
                        const request = ws_message.request;
                        this.apply(emitter, {
                            datacenterid: request.datacenterid,
                            image: request.image,
                            inputs: request.inputs,
                            state: request.state ? JSON.parse(request.state) : undefined,
                            destroy: request.destroy,
                        });
                    }
                    else {
                        emitter.error(`Invalid command: ${ws_message.command}`);
                    }
                }
                else {
                    emitter.error(`Invalid message: ${message}`);
                }
            });
        });
    }
}
exports.BasePlugin = BasePlugin;
