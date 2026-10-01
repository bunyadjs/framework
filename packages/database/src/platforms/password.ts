/** Runtime-pluggable password hash/verify (ORM `hashed` cast, auth Hash). */
export type PasswordHashOptions = {
  algorithm: "bcrypt";
  cost: number;
};

export type PasswordPlatform = {
  hash(value: string, options: PasswordHashOptions): Promise<string>;
  hashSync(value: string, options: PasswordHashOptions): string;
  verify(value: string, hash: string): Promise<boolean>;
};
