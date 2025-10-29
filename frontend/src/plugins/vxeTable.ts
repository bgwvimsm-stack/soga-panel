import "vxe-table/lib/style.css";
import type { App } from "vue";

import {
  VXETable,
  Custom,
  Icon,
  Column,
  Grid,
  Pager,
  Select,
  Table
} from "vxe-table";

// 全局默认参数
VXETable.setConfig({});

export function useVxeTable(app: App) {
  app
    .use(Custom)
    .use(Icon)
    .use(Column)
    .use(Grid)
    .use(Pager)
    .use(Select)
    .use(Table);
}
