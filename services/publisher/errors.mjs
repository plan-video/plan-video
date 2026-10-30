/** Why a post didn't go out, worded for the person whose post it is. */
export class PublishError extends Error {
  /**
   * `retry`: the network or a connection failed for now, so the same send may
   * work in a few minutes. `expired`: the login has to be connected again.
   * `until`: a limit on the plan is used for now, so the post waits until
   * this moment, without it counting as a try.
   */
  constructor(message, { retry = false, expired = false, until = null } = {}) {
    super(message);
    this.retry = retry;
    this.expired = expired;
    this.until = until;
  }
}

/** A refusal for the HTTP side, with its status. */
export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
