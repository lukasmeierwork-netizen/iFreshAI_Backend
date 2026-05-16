export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(opts: { status: number; code: string; message: string }) {
    super(opts.message);
    this.name = "HttpError";
    this.status = opts.status;
    this.code = opts.code;
  }
}

