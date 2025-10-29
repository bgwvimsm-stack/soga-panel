<script setup lang="ts">
import { useRouter } from "vue-router";
import { isAdmin } from "@/utils/auth-soga";
import noAccess403 from "@/assets/status/403.svg";

defineOptions({
  name: "403"
});

const router = useRouter();

const goHome = () => {
  router.push(isAdmin() ? "/admin/dashboard" : "/user/dashboard");
};
</script>

<template>
  <div class="error-page">
    <div class="error-container">
      <div class="error-image">
        <img :src="noAccess403" alt="403" />
      </div>
      <div class="error-content">
        <div class="error-code">403</div>
        <div class="error-message">抱歉，你无权访问该页面</div>
        <div class="error-actions">
          <el-button type="primary" @click="goHome">
            返回首页
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.error-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%);
  padding: 20px;
}

.error-container {
  display: flex;
  align-items: center;
  gap: 48px;
  max-width: 800px;
  
  @media (max-width: 768px) {
    flex-direction: column;
    gap: 32px;
    text-align: center;
  }
}

.error-image {
  width: 320px;
  height: 320px;
  flex-shrink: 0;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  
  @media (max-width: 768px) {
    width: 240px;
    height: 240px;
  }
}

.error-content {
  color: #303133;
  
  .error-code {
    font-size: 72px;
    font-weight: bold;
    margin-bottom: 16px;
    color: #e6a23c;
    
    @media (max-width: 768px) {
      font-size: 56px;
    }
  }
  
  .error-message {
    font-size: 20px;
    margin-bottom: 32px;
    color: #606266;
    line-height: 1.5;
    
    @media (max-width: 768px) {
      font-size: 18px;
    }
  }
  
  .error-actions {
    .el-button {
      padding: 12px 24px;
      font-size: 16px;
    }
  }
}
</style>