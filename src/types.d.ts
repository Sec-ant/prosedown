declare module "virtual:code-theme-colors" {
  import type { CodeThemeColors } from "./theme-metadata";

  const colors: Readonly<Record<string, CodeThemeColors>>;
  export default colors;
}

declare module "virtual:code-theme-lists" {
  import type { ThemeLists } from "./theme-metadata";

  const lists: ThemeLists;
  export default lists;
}

declare module "virtual:page-theme-lists" {
  import type { ThemeLists } from "./theme-metadata";

  const lists: ThemeLists;
  export default lists;
}

declare module "daisyui/functions/themeOrder.js" {
  const themeOrder: string[];
  export default themeOrder;
}
