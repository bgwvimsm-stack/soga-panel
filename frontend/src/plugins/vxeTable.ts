import "vxe-table/lib/style.css";
import type { App } from "vue";

import {
  VXETable,
  Column,
  Grid,
  Table,
  Toolbar
} from "vxe-table";

// 全局默认参数
VXETable.setConfig({});

export function useVxeTable(app: App) {
  app
    .use(Column)
    .use(Toolbar)
    .use(Grid)
    .use(Table);
}
