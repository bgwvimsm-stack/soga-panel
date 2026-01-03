import "vxe-table/lib/style.css";
import "vxe-pc-ui/lib/style.css";
import type { App } from "vue";

import {
  VxeUI,
  Column,
  Grid,
  Table,
  Toolbar
} from "vxe-table";
import { Pager } from "vxe-pc-ui";

// 全局默认参数
VxeUI.setConfig({});

export function useVxeTable(app: App) {
  app
    .use(Column)
    .use(Pager)
    .use(Toolbar)
    .use(Grid)
    .use(Table);
}
