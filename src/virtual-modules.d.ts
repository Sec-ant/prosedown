declare module "virtual:code-theme-colors" {
  const colors: Record<
    string,
    { bg: string; fg: string; accent1: string; accent2: string; accent3: string }
  >;
  export default colors;
}
