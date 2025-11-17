<script setup lang="ts">
import { useRouter } from "vue-router";
import NoAccess from "@/assets/status/403.svg?component";

defineOptions({
  name: "403"
});

const router = useRouter();

const goHome = () => {
  router.push("/");
};
</script>

<template>
  <div class="error-wrapper warn">
    <div class="error-inner">
      <NoAccess class="error-illustration" />
      <div class="error-content">
        <p class="error-code">403</p>
        <p class="error-title">抱歉，你无权访问该页面</p>
        <el-button type="primary" @click="goHome">返回首页</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.error-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(135deg, #fff4ec 0%, #ffe2d3 100%);

  &.warn {
    background: linear-gradient(135deg, #fff4ec 0%, #ffe2d3 100%);
  }
}

.error-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 24px;
  max-width: 720px;

  @media (min-width: 768px) {
    flex-direction: row;
    text-align: left;
    gap: 48px;
  }
}

.error-illustration {
  width: 300px;
  max-width: 100%;
}

.error-content {
  .error-code {
    font-size: 60px;
    font-weight: 700;
    color: #f97316;
    margin: 0 0 12px 0;
  }

  .error-title {
    font-size: 20px;
    color: #475569;
    margin: 0 0 24px 0;
  }
}
</style>
