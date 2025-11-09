import { ref, Ref } from 'vue';
import { ElMessage } from 'element-plus';

export interface AsyncState<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  retry: () => Promise<T>;
}

export function useAsync<T, TArgs extends unknown[] = unknown[]>(
  asyncFunction: (...args: TArgs) => Promise<T>,
  immediate = false,
  defaultValue: T | null = null
): AsyncState<T> & { execute: (...args: TArgs) => Promise<T> } {
  const data = ref<T | null>(defaultValue) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<Error | null>(null);
  let lastArgs: TArgs = [] as unknown as TArgs;

  const execute = async (...args: TArgs): Promise<T> => {
    lastArgs = args;
    loading.value = true;
    error.value = null;

    try {
      const result = await asyncFunction(...args);
      data.value = result;
      return result;
    } catch (err) {
      error.value = err as Error;
      console.error('异步操作失败:', err);
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const retry = () => execute(...lastArgs);

  if (immediate) {
    execute(...([] as unknown as TArgs));
  }

  return {
    data,
    loading,
    error,
    execute,
    retry
  };
}

export function useAsyncWithMessage<T, TArgs extends unknown[] = unknown[]>(
  asyncFunction: (...args: TArgs) => Promise<T>,
  options: {
    successMessage?: string;
    errorMessage?: string;
    immediate?: boolean;
    defaultValue?: T | null;
  } = {}
): AsyncState<T> & { execute: (...args: TArgs) => Promise<T> } {
  const {
    successMessage,
    errorMessage = '操作失败',
    immediate = false,
    defaultValue = null
  } = options;

  const asyncState = useAsync<T, TArgs>(asyncFunction, false, defaultValue);

  const executeWithMessage = async (...args: TArgs): Promise<T> => {
    try {
      const result = await asyncState.execute(...args);
      if (successMessage) {
        ElMessage.success(successMessage);
      }
      return result;
    } catch (err) {
      ElMessage.error(errorMessage);
      throw err;
    }
  };

  if (immediate) {
    executeWithMessage(...([] as unknown as TArgs));
  }

  return {
    ...asyncState,
    execute: executeWithMessage
  };
}
