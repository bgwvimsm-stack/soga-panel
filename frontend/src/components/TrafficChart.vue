<template>
  <div ref="chartRef" class="traffic-chart" :style="{ height: height }" />
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { formatBytes } from '@/utils/format';

interface TrafficData {
  date: string;
  label: string;
  upload_traffic: number;
  download_traffic: number;
  total_traffic: number;
}

interface Props {
  data: TrafficData[];
  loading?: boolean;
  height?: string;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  height: '400px',
  title: '流量趋势图'
});

const chartRef = ref<HTMLDivElement>();
let chartInstance: echarts.ECharts | null = null;

// formatBytes函数已从@/utils/format导入

// 图表配置
const chartOption = computed<EChartsOption>(() => {
  if (!props.data || props.data.length === 0) {
    return {
      title: {
        text: '暂无流量记录',
        left: 'center',
        top: 'middle',
        textStyle: {
          fontSize: 16,
          color: '#909399'
        }
      }
    } as unknown as EChartsOption;
  }

  // 直接使用后端返回的label作为X轴标签
  const labels = props.data.map(item => item.label || item.date);
  
  const uploadData = props.data.map(item => (item.upload_traffic / 1024 / 1024).toFixed(1));
  const downloadData = props.data.map(item => (item.download_traffic / 1024 / 1024).toFixed(1));

  // 对于按日期统计的数据，不需要滚动条
  const needScroll = false;
  const scrollbarEnabled = false;

  return {
    title: {
      text: props.title,
      left: 'center',
      textStyle: {
        fontSize: 16,
        fontWeight: 600,
        color: '#303133'
      },
      top: 10
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'none'
      },
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e4e7ed',
      borderWidth: 1,
      textStyle: {
        color: '#303133',
        fontSize: 13
      },
      formatter: function(params: Array<{axisValue: string; value: string; color: string; seriesName: string}>) {
        const time = params[0].axisValue;
        let result = `${time}<br/>`;
        params.forEach((param) => {
          const value = parseFloat(param.value);
          result += `<span style="color: ${param.color};">●</span> ${param.seriesName}: ${formatBytes(value * 1024 * 1024)}<br/>`;
        });
        return result;
      }
    },
    grid: {
      top: 60,
      left: 60,
      right: 40,
      bottom: scrollbarEnabled ? 80 : 60,
      containLabel: false
    },
    legend: {
      data: ['上传流量', '下载流量'],
      textStyle: {
        color: '#606266',
        fontSize: 14
      },
      top: 35,
      itemWidth: 12,
      itemHeight: 12
    },
    // 按日期显示不需要滚动条
    dataZoom: undefined,
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: true,
      axisLabel: {
        fontSize: 12,
        color: '#606266',
        interval: 0,
        rotate: 0
      },
      axisLine: {
        lineStyle: {
          color: '#e4e7ed'
        }
      },
      axisTick: {
        alignWithLabel: true,
        lineStyle: {
          color: '#e4e7ed'
        }
      }
    },
    yAxis: {
      type: 'value',
      name: 'MB',
      nameTextStyle: {
        color: '#606266',
        fontSize: 12,
        padding: [0, 0, 0, -10]
      },
      axisLabel: {
        fontSize: 12,
        color: '#606266',
        formatter: '{value}'
      },
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: '#f5f7fa',
          type: 'solid'
        }
      }
    },
    series: [
      {
        name: '上传流量',
        type: 'bar',
        barWidth: 30,
        barGap: '10%',
        itemStyle: {
          color: '#5470c6',
          borderRadius: [4, 4, 0, 0]
        },
        emphasis: {
          itemStyle: {
            color: '#4361a5'
          }
        },
        data: uploadData
      },
      {
        name: '下载流量',
        type: 'bar',
        barWidth: 30,
        barGap: '10%',
        itemStyle: {
          color: '#91cc75',
          borderRadius: [4, 4, 0, 0]
        },
        emphasis: {
          itemStyle: {
            color: '#7db55a'
          }
        },
        data: downloadData
      }
    ],
    animation: true,
    animationDuration: 1000,
    animationEasing: 'cubicOut'
  } as unknown as EChartsOption;
});

// 初始化图表
const initChart = () => {
  if (chartRef.value && !chartInstance) {
    chartInstance = echarts.init(chartRef.value);
    updateChart();
  }
};

// 更新图表
const updateChart = async () => {
  if (!chartInstance) return;
  
  await nextTick();
  
  if (props.loading) {
    chartInstance.showLoading({
      text: '加载中...',
      color: '#41b6ff',
      textColor: '#606266',
      maskColor: 'rgba(255, 255, 255, 0.8)',
      zlevel: 0,
      spinnerRadius: 10,
      lineWidth: 3
    });
  } else {
    chartInstance.hideLoading();
    chartInstance.setOption(chartOption.value, true);
  }
};

// 响应式处理
const resizeChart = () => {
  if (chartInstance) {
    chartInstance.resize();
  }
};

// 监听数据变化，优化性能：只监听必要的属性
watch(() => [props.data, props.loading], updateChart, { 
  immediate: false 
});

// 单独监听配置变化
watch(chartOption, updateChart, { 
  immediate: false 
});

// 生命周期
onMounted(() => {
  initChart();
  window.addEventListener('resize', resizeChart);
});

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
  window.removeEventListener('resize', resizeChart);
});
</script>

<style scoped lang="scss">
.traffic-chart {
  width: 100%;
  background: #ffffff;
  border-radius: 8px;
  position: relative;
  
  &:hover {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    transition: box-shadow 0.3s ease;
  }
}
</style>
