import { expect } from "chai";
import { DEFAULT_TIMEOUT } from "./constants";

export class TestUtils {
  public static async waitForSuccess<T>(
    locatorFn: () => Promise<T>,
    timeout: number = DEFAULT_TIMEOUT.MD,
    interval: number = 500,
  ): Promise<T> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const result = await locatorFn();
        return result;
      } catch {
        // keep trying
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(
      `Element not found after ${timeout}ms timeout: ${locatorFn}`,
    );
  }

  public static async expectNoElement<T>(
    locatorFn: () => Promise<T>,
    timeout: number = 1000,
    interval: number = 200,
  ): Promise<void> {
    const startTime = Date.now();
    let elementFound = false;

    while (Date.now() - startTime < timeout) {
      try {
        const element = await locatorFn();
        if (element) {
          elementFound = true;
          break;
        }
      } catch {
        // element not found
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    expect(elementFound).to.be.false;
  }

  public static waitForTimeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
