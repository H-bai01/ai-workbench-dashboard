<template>
  <router-view />
</template>

<script setup lang="ts">
// App shell — router handles layout
</script>

<style>
/* Global resets */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

#app {
  min-height: 100vh;
  background-color: var(--bg-primary);
}
</style>
