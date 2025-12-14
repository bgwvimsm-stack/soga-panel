import { defineStore } from "pinia";
import { ref } from "vue";
import type { User } from "@/api/types";
import { getUser, setUser as setUserStorage, removeToken } from "@/utils/auth-soga";

export const useUserStore = defineStore("user", () => {
  const user = ref<User | null>(getUser());
  const isLoggedIn = ref<boolean>(!!user.value);

  const setUser = (userData: User) => {
    user.value = userData;
    isLoggedIn.value = true;
    setUserStorage(userData);
  };

  const clearUser = () => {
    user.value = null;
    isLoggedIn.value = false;
    removeToken();
  };

  const updateUser = (userData: Partial<User>) => {
    if (user.value) {
      // 使用深拷贝确保响应式更新
      const updatedUser = { ...user.value, ...userData };
      user.value = updatedUser;
      setUserStorage(updatedUser);
    }
  };

  const isAdmin = (): boolean => {
    const flag = user.value?.is_admin;
    return flag === true || flag === 1 || flag === "1";
  };

  const isUserEnabled = (): boolean => {
    // 用户状态：1=启用，0=禁用
    return user.value?.status === 1;
  };

  const isDisabledUser = (): boolean => {
    // 检查用户是否被禁用
    return user.value?.status === 0;
  };

  return {
    user,
    isLoggedIn,
    setUser,
    clearUser,
    updateUser,
    isAdmin,
    isUserEnabled,
    isDisabledUser
  };
});
