<script setup lang="ts">
import { useRouter } from "vue-router";
import NoServer from "@/assets/status/500.svg?component";

defineOptions({
  name: "500"
});

const router = useRouter();

const goHome = () => {
  router.push("/");
};
</script>

<template>
  <div class="error-wrapper danger">
    <div class="error-inner">
      <NoServer class="error-illustration" />
      <div class="error-content">
        <p class="error-code">500</p>
        <p class="error-title">抱歉，服务器出错了</p>
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
  background: linear-gradient(135deg, #fff0f0 0%, #ffe0e0 100%);

  &.danger {
    background: linear-gradient(135deg, #fff0f0 0%, #ffe0e0 100%);
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
  width: 320px;
  max-width: 100%;
}

.error-content {
  .error-code {
    font-size: 60px;
    font-weight: 700;
    color: #ef4444;
    margin: 0 0 12px 0;
  }

  .error-title {
    font-size: 20px;
    color: #475569;
    margin: 0 0 24px 0;
  }
}
</style>
