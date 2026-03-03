/**
 * Async Queue with Concurrency Control
 * 
 * Manages parallel task execution with a configurable concurrency limit
 * to prevent memory issues and rate limiting during batch scraping.
 */

export class AsyncQueue {
    constructor(concurrency = 3) {
        this.concurrency = concurrency;
        this.running = 0;
        this.queue = [];
        this.paused = false;
        this.results = [];
    }

    /**
     * Add a task to the queue
     * @param {Function} task - Async function to execute
     * @returns {Promise<any>} Resolves with task result
     */
    add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    /**
     * Add multiple tasks at once
     * @param {Function[]} tasks - Array of async functions
     * @returns {Promise<any[]>} Array of results
     */
    addAll(tasks) {
        return Promise.all(tasks.map(task => this.add(task)));
    }

    /**
     * Process the queue
     */
    async process() {
        if (this.paused) return;

        while (this.running < this.concurrency && this.queue.length > 0) {
            const { task, resolve, reject } = this.queue.shift();
            this.running++;

            task()
                .then(result => {
                    this.results.push({ success: true, result });
                    resolve(result);
                })
                .catch(error => {
                    this.results.push({ success: false, error });
                    reject(error);
                })
                .finally(() => {
                    this.running--;
                    this.process();
                });
        }
    }

    /**
     * Pause queue processing
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume queue processing
     */
    resume() {
        this.paused = false;
        this.process();
    }

    /**
     * Clear the queue
     */
    clear() {
        this.queue = [];
    }

    /**
     * Get current queue size
     * @returns {number} Number of pending tasks
     */
    get size() {
        return this.queue.length;
    }

    /**
     * Get number of running tasks
     * @returns {number} Number of active tasks
     */
    get active() {
        return this.running;
    }

    /**
     * Check if queue is empty and no tasks running
     * @returns {boolean}
     */
    get idle() {
        return this.queue.length === 0 && this.running === 0;
    }

    /**
     * Wait for all current tasks to complete
     * @returns {Promise<void>}
     */
    async onIdle() {
        return new Promise(resolve => {
            const check = () => {
                if (this.idle) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }
}

export default AsyncQueue;
