<template>
  <div class="sidebar-announcements">
    <div class="announcements-header">
      <el-icon class="header-icon">
        <Bell />
      </el-icon>
      <span class="header-text">最新公告</span>
    </div>
    <div class="announcement-item" :class="`announcement-${announcement.type}`">
      <div class="announcement-title">{{ announcement.title }}</div>
      <div class="announcement-content">{{ getShortContent(announcement.content) }}</div>
      <div class="announcement-time">{{ formatAnnouncementTime(announcement.created_at) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Bell } from '@element-plus/icons-vue';
import type { Announcement } from '@/api/announcement';

interface Props {
  announcement: Announcement;
}

defineProps<Props>();

const getShortContent = (content: string): string => {
  const plainText = content
    .replace(/[#*_`~]/g, '')
    .replace(/\n/g, ' ')
    .trim();
  
  return plainText.length > 50 ? plainText.substring(0, 50) + '...' : plainText;
};

const formatAnnouncementTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  
  if (diffInMinutes < 1) return '刚刚';
  if (diffInMinutes < 60) return `${diffInMinutes}分钟前`;
  if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}小时前`;
  if (diffInMinutes < 43200) return `${Math.floor(diffInMinutes / 1440)}天前`;
  
  return date.toLocaleDateString('zh-CN');
};
</script>

<style scoped lang="scss">
.sidebar-announcements {
  margin: 15px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(0, 0, 0, 0.15);
    border-color: rgba(255, 255, 255, 0.2);
  }
  
  .announcements-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #ffd04b;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 10px;
    
    .header-icon {
      font-size: 14px;
      flex-shrink: 0;
    }
    
    .header-text {
      flex: 1;
    }
  }
  
  .announcement-item {
    padding: 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 3px solid transparent;
    transition: all 0.3s ease;
    
    &.announcement-info {
      border-left-color: #409eff;
    }
    
    &.announcement-warning {
      border-left-color: #e6a23c;
    }
    
    &.announcement-success {
      border-left-color: #67c23a;
    }
    
    &.announcement-danger {
      border-left-color: #f56c6c;
    }
    
    .announcement-title {
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .announcement-content {
      color: rgba(255, 255, 255, 0.8);
      font-size: 11px;
      line-height: 1.4;
      margin-bottom: 6px;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    
    .announcement-time {
      color: rgba(255, 255, 255, 0.5);
      font-size: 10px;
    }
  }
}
</style>