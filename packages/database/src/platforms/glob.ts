/** Runtime-pluggable file glob (migrator discovery). */
export type FileGlob = {
  /** Yield matching paths relative to `cwd`. */
  scan(options: { cwd: string }): AsyncIterable<string>;
};

export type CreateGlob = (pattern: string) => FileGlob;
