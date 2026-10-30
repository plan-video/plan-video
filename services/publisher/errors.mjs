/** Why a post didn't go out, worded for the person whose post it is. */
export class PublishError extends Error {
  /**
   * `retry`: the same send may work in a few minutes. `expired`: the login has to be connected again.
   * `until`: a plan limit is used for now, so the post waits until then without it counting as a try.
   */
  constructor(message, { retry = false, expired = false, until = null } = {}) {
    super(message);
    this.retry = retry;
    this.expired = expired;
    this.until = until;
  }
}

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
