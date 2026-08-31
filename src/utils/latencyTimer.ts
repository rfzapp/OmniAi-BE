// src/utils/latencyTimer.ts

/**
 * Simple utility to measure elapsed time between start and stop points.
 * Usage:
 *   const timer = new LatencyTimer('operationName');
 *   timer.start();
 *   // ... code ...
 *   timer.stop();
 *   console.log(timer.report());
 */
export class LatencyTimer {
  private startTime: number | null = null;
  private endTime: number | null = null;
  private readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  /** Start the timer */
  start() {
    this.startTime = Date.now();
  }

  /** Stop the timer */
  stop() {
    this.endTime = Date.now();
  }

  /** Get elapsed milliseconds */
  elapsed(): number | null {
    if (this.startTime !== null) {
      return (this.endTime ?? Date.now()) - this.startTime;
    }
    return null;
  }

  /** Return a formatted report string */
  report(): string {
    const elapsed = this.elapsed();
    return `${this.label}: ${elapsed !== null ? `${elapsed}ms` : 'not stopped'}`;
  }
}
