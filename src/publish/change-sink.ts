// Port: where a compiled change goes when it is published as a branch + pull request (ADR-0007 D10).
export interface ChangeFile {
  /** Relative POSIX path inside the repository. */
  readonly path: string;
  readonly content: string;
}

export interface PublishableChange {
  /** Four digits, as in `changes/NNNN-<slug>`. */
  readonly number: string;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly files: readonly ChangeFile[];
}

export interface PublishedChange {
  readonly branch: string;
  readonly url: string;
}

/** Files are created or replaced as regular files (mode 100644); executables and symlinks at those paths become regular files. */
export interface ChangeSink {
  publish(change: PublishableChange): Promise<PublishedChange>;
}
