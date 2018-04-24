/*!
 * IMQClient implementation
 *
 * Copyright (c) 2018, Mykhailo Stadnyk <mikhus@gmail.com>
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */
import IMQ, {
    IMessageQueue,
    IMQOptions,
    ILogger
} from 'imq';
import {
    pid,
    forgetPid,
    osUuid,
    DEFAULT_IMQ_CLIENT_OPTIONS,
    ServiceDescription,
    IMQServiceOptions,
    IMQClientOptions,
    IMQRPCResponse,
    IMQRPCRequest,
    IMQDelay,
    remote
} from '.';
import { EventEmitter } from 'events';

const SIGNALS: string[] = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK'];

/**
 * Class IMQClient - base abstract class for service clients.
 */
export abstract class IMQClient extends EventEmitter {

    public options: IMQClientOptions;
    public id: number;
    private imq: IMessageQueue;
    private name: string;
    private serviceName: string;
    private logger: ILogger;
    private resolvers: { [id: string]: [Function, Function] } = {};

    /**
     * Class constructor
     *
     * @constructor
     * @param {Partial<IMQOptions>} options
     * @param {string} serviceName
     * @param {string} name
     */
    public constructor(
        options?: Partial<IMQClientOptions>,
        serviceName?: string,
        name?: string
    ) {
        super();

        const baseName: string = name || this.constructor.name;

        if (this.constructor.name === 'IMQClient') {
            throw new TypeError('IMQClient class is abstract and can not' +
                'be instantiated directly!');
        }

        this.options = Object.assign({},
            DEFAULT_IMQ_CLIENT_OPTIONS,
            options || {}
        );

        this.id = pid(baseName);
        this.logger = this.options.logger || console;
        this.name = `${baseName}-${osUuid()}-${this.id}`;
        this.serviceName = serviceName || baseName.replace(/Client$/, '');
        this.imq = IMQ.create(this.name, this.options);

        this.imq.on('message', (message: IMQRPCResponse) => {
            process.nextTick(() => {
                if (!this.resolvers[message.to]) {
                    // when there is no resolvers it means
                    // we have massage in queue which was initiated
                    // by some process which is broken. So we provide an
                    // ability to handle enqueued messages via EventEmitter
                    // interface
                    this.emit(message.request.method, message);
                }

                const [ resolve, reject ] = this.resolvers[message.to];

                if (message.error) {
                    return  reject(message.error);
                }

                resolve(message.data);
            });
        });

        const terminate = async () => {
            forgetPid(baseName, this.id, this.logger);
            await this.destroy();
            process.nextTick(() => process.exit(0));
        };

        SIGNALS.forEach((signal: any) => process.on(signal, terminate));
        process.on('exit', terminate);
    }

    /**
     * Sends call to remote service method
     *
     * @access protected
     * @param {...any[]} args
     * @returns {Promise<T>}
     */
    protected async remoteCall<T>(...args: any[]): Promise<T> {
        const method = args.pop();
        const from = this.name;
        const to = this.serviceName;
        let delay: number = 0;

        if (args[args.length - 1] instanceof IMQDelay) {
            delay = args.pop().ms;

            if (!isFinite(delay) || isNaN(delay) || delay < 0) {
                delay = 0;
            }
        }

        return new Promise<T>(async (resolve, reject) => {
            try {
                const message: IMQRPCRequest = { from, method, args};
                const id = await this.imq.send(to, message, delay, reject);

                this.resolvers[id] = [resolve, reject];
            }

            catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Initializes client work
     *
     * @returns {Promise<void>}
     */
    public async start() {
        await this.imq.start();
    }

    /**
     * Stops client work
     *
     * @returns {Promise<void>}
     */
    public async stop() {
        await this.imq.stop();
    }

    /**
     * Destroys client
     *
     * @returns {Promise<void>}
     */
    public async destroy() {
        for (let event of this.eventNames()) {
            this.removeAllListeners(event);
        }

        await this.imq.destroy();
    }

    /**
     * Creates client for a sirvice with the given name
     *
     * @param {string} name
     * @param {Partial<IMQServiceOptions>} options
     * @returns {IMQClient}
     */
    public static async create(
        name: string,
        options?: Partial<IMQClientOptions>
    ): Promise<IMQClient> {
        const clientOptions: IMQClientOptions = Object.assign({},
            DEFAULT_IMQ_CLIENT_OPTIONS,
            options
        );
        const Client = require(await generator(name, clientOptions));

        return new Client(clientOptions, name);
    }

}

/**
 * Class GeneratorClient - generator helper class implementation
 * @access private
 */
class GeneratorClient extends IMQClient {
    @remote()
    public async describe() {
        return await this.remoteCall<ServiceDescription>(...arguments);
    }
}

/**
 * Client generator helper function
 *
 * @access private
 * @param {string} name
 * @param {IMQClientOptions} options
 * @return {Promise<string>}
 */
async function generator(
    name: string,
    options: IMQClientOptions
): Promise<string> {

    return '';
}
