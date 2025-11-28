<template>
  <svg
    class="crypto-icon"
    viewBox="0 0 64 64"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1abc9c" />
        <stop offset="100%" stop-color="#16a085" />
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#grad)" />
    <path
      d="M22 22h20v4H22v-4zm0 8h20v4H22v-4zm8 8h12v4H30v-4zm-8 0h6v4h-6v-4z"
      fill="#fff"
      opacity="0.92"
    />
    <path
      d="M30 16h4v32h-4z"
      fill="#fff"
      opacity="0.92"
    />
  </svg>
</template>

<style scoped>
.crypto-icon {
  width: 18px;
  height: 18px;
  vertical-align: middle;
}
</style>
