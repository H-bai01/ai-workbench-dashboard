<template>
  <el-dialog
    v-model="dialogVisible"
    title="OpenClaw 技能库"
    width="min(1180px, 94vw)"
    :close-on-click-modal="false"
    destroy-on-close
    class="skills-dialog"
    :modal-class="'skills-dialog-modal'"
    top="4vh"
  >
    <!-- 顶部统计栏 -->
    <div v-if="skillsData" class="skills-stats-bar">
      <div class="stats-item">
        <span class="stats-label">全部技能</span>
        <span class="stats-value">{{ skillsData.total }}</span>
      </div>
      <div class="stats-divider" />
      <div class="stats-item">
        <span class="stats-label">已就绪</span>
        <span class="stats-value stats-ready">{{ skillsData.ready }}</span>
      </div>
      <el-button
        v-if="skillsData.skills.length > 0"
        class="refresh-skills-btn"
        :icon="Refresh"
        circle
        size="small"
        @click="fetchSkills"
        :loading="loading"
      />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading && !skillsData" class="skills-loading">
      <el-icon :size="24" class="is-loading"><Loading /></el-icon>
      <span>加载技能列表...</span>
    </div>

    <!-- Tab 标签页 -->
    <el-tabs v-else-if="skillsData?.skills.length" v-model="activeTab" class="skills-tabs">
      <el-tab-pane name="activated">
        <template #label>
          <span>已激活</span>
          <el-tag size="small" type="success" class="tab-count">{{ activatedSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="deactivated">
        <template #label>
          <span>未激活</span>
          <el-tag size="small" type="info" class="tab-count">{{ deactivatedSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="notInstalled">
        <template #label>
          <span>未安装</span>
          <el-tag size="small" type="info" class="tab-count">{{ notInstalledSkills.length }}</el-tag>
        </template>
      </el-tab-pane>
      <el-tab-pane name="byAgent">
        <template #label>
          <span>按 Agent</span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="compare">
        <template #label>
          <span>对比</span>
        </template>
      </el-tab-pane>
      <el-tab-pane name="clawhub">
        <template #label>
          <span>ClawHub</span>
        </template>
      </el-tab-pane>
      <!-- Sprint 8 #8: 使用统计标签页 -->
      <el-tab-pane name="usage">
        <template #label>
          <span class="tab-label-icon"><el-icon><TrendCharts /></el-icon> 使用统计</span>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- ══ Sprint 8 #8: 使用统计 tab ══ -->
    <div v-if="activeTab === 'usage'" class="usage-section">
      <div class="usage-header">
        <span class="usage-title">工具调用排行榜（近 {{ usageDays }} 天）</span>
        <div class="usage-range-btns">
          <button v-for="d in [7, 30, 90]" :key="d"
            class="usage-range-btn" :class="{ active: usageDays === d }"
            @click="setUsageDays(d)">近{{ d }}天</button>
        </div>
        <el-button size="small" :loading="usageLoading" @click="fetchUsage" style="margin-left:8px">刷新</el-button>
      </div>

      <div v-if="usageLoading" class="usage-loading">
        <el-icon class="is-loading" :size="20"><Loading /></el-icon>
        <span>正在扫描 session 文件...</span>
      </div>

      <div v-else-if="usageRanked.length === 0" class="usage-empty">
        <div>过去 {{ usageDays }} 天内没有工具调用记录</div>
      </div>

      <div v-else class="usage-list">
        <div v-for="(item, idx) in usageRanked" :key="item.name" class="usage-row" @click="openUsageToolDetail(item)">
          <span class="usage-rank">#{{ idx + 1 }}</span>
          <img class="skill-logo-img usage-logo" :src="getSkillLogoSrc(item.name)" :alt="getUsageDisplayName(item.name)" />
          <div class="usage-name-cell">
            <span class="usage-name">{{ getUsageDisplayName(item.name) }}</span>
            <span class="usage-name-zh">{{ getUsageCategory(item.name) }} · {{ item.name }}</span>
          </div>
          <div class="usage-bar-wrap">
            <div class="usage-bar" :style="{ width: (item.total / usageRanked[0].total * 100).toFixed(1) + '%', background: usageBarColor(idx) }"></div>
          </div>
          <span class="usage-count">{{ item.total.toLocaleString() }} 次</span>
          <div class="usage-agents">
            <el-tooltip
              v-for="(cnt, agId) in item.byAgent" :key="agId"
              :content="`${agId}: ${cnt} 次`"
              placement="top"
            >
              <img class="usage-agent-dot" :src="getAgentAvatar(String(agId))" :alt="String(agId)" @error="setDefaultAvatar" />
            </el-tooltip>
          </div>
        </div>
        <div class="usage-footer-note">
          共 {{ usageTotalCalls.toLocaleString() }} 次工具调用 · 更新于 {{ usageUpdatedAt }}
        </div>
      </div>

      <!-- 未使用明细：已安装未启用 / 未安装的技能，折叠展示，方便管理 -->
      <div v-if="unusedSkillsList.length > 0" class="usage-unused-section">
        <div class="usage-unused-header" @click="unusedSkillsExpanded = !unusedSkillsExpanded">
          <span class="usage-unused-chevron" :class="{ collapsed: !unusedSkillsExpanded }">▾</span>
          <span class="usage-unused-title"><el-icon><List /></el-icon> 未使用明细 · {{ unusedSkillsList.length }} 项</span>
          <span class="usage-unused-hint">已安装未启用 / 未安装的技能，点击展开查看</span>
        </div>
        <div v-show="unusedSkillsExpanded" class="usage-unused-body">
          <div v-for="(items, cat) in unusedSkillsByCategory" :key="cat" class="usage-unused-cat">
            <div class="usage-unused-cat-name"><el-icon><component :is="getCategoryIcon(String(cat))" /></el-icon> {{ cat }}（{{ items.length }}）</div>
            <div class="usage-unused-grid">
              <button
                v-for="s in items" :key="s.name"
                class="usage-unused-card"
                :class="{ 'usage-unused-card--off': s.statusLabel === '未安装' }"
                @click.stop="openSkillDoc(s.name)"
              >
                <img class="skill-logo-img usage-unused-logo" :src="getSkillLogoSrc(s.name)" :alt="s.displayName" />
                <span class="usage-unused-main">
                  <strong>{{ s.displayName }}</strong>
                  <small>{{ s.category }} · {{ s.name }}</small>
                  <span :class="['skill-source-badge', 'usage-unused-source', `skill-source-badge--${getSkillSourceKind(s)}`]" :title="getSkillSourceTitle(s)">
                    {{ getSkillSourceText(s) }}
                  </span>
                </span>
                <em>{{ s.statusLabel }}</em>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ 按 Agent tab ══ -->
    <div v-if="activeTab === 'byAgent' && skillsData" class="by-agent-section">
      <!-- Agent 选择器 -->
      <div class="agent-chips">
        <div
          v-for="agent in agentsConfigured"
          :key="agent.id"
          :class="['agent-chip', selectedAgentId === agent.id ? 'agent-chip--active' : '']"
          @click="selectedAgentId = agent.id"
        >
          <img class="agent-chip-avatar" :src="getAgentAvatar(agent.id)" :alt="agent.name || agent.id" @error="setDefaultAvatar" />
          <span class="agent-chip-name">{{ shortAgentName(agent.name || agent.id) }}</span>
          <span class="agent-chip-count">{{ agent.skills.length }}</span>
        </div>
      </div>

      <!-- 已选 Agent 的技能（按分类） -->
      <el-scrollbar class="skills-scrollbar" v-if="selectedAgentId">
        <div v-if="selectedAgentSkills.length === 0" class="agent-no-skills">
          <el-empty description="该 Agent 暂未配置技能" :image-size="60" />
        </div>
        <template v-else v-for="(group, catName) in selectedAgentSkillsByCategory" :key="catName">
          <div class="category-header" @click="toggleCatAgent(String(catName))">
            <el-icon class="category-icon"><component :is="getCategoryIcon(String(catName))" /></el-icon>
            <span class="category-name">{{ catName }}</span>
            <span class="category-count">{{ group.length }}</span>
            <span class="category-chevron" :class="{ collapsed: collapsedCatsAgent.has(String(catName)) }">▾</span>
          </div>
          <div v-show="!collapsedCatsAgent.has(String(catName))" class="skills-list-compact">
            <div
              v-for="skill in group"
              :key="skill.name"
              :class="[
                'skill-row',
                skill.enabled ? 'skill-row--enabled'
                  : skill.installed ? 'skill-row--inactive'
                  : 'skill-row--uninstalled',
                expandedSkillName === skill.name ? 'skill-row--expanded' : ''
              ]"
              @click.stop="toggleSkillExpand(skill.name)"
            >
              <div class="skill-row-status">
                <img class="skill-logo-img skill-row-logo" :src="getSkillLogoSrc(skill.name)" :alt="getSkillDisplayName(skill.name)" />
              </div>
              <div class="skill-row-info">
                <div class="skill-row-name">
                  {{ getSkillDisplayName(skill.name) }}
                  <span class="skill-row-id">{{ getSkillCategory(skill.name) }} · {{ getSkillStatusLabel(skill) }}</span>
                  <span :class="['skill-source-badge', `skill-source-badge--${getSkillSourceKind(skill)}`]" :title="getSkillSourceTitle(skill)">
                    {{ getSkillSourceText(skill) }}
                  </span>
                </div>
                <div class="skill-row-desc">{{ getSkillDescription(skill.name) }}</div>
                <div v-if="expandedSkillName === skill.name" class="skill-row-expand" @click.stop>
                  <div v-if="expandedSkillLoading" class="skill-row-expand-loading">加载中...</div>
                  <template v-else>
                    <div class="skill-detail-summary">{{ getExpandedSkillSummary(skill.name) }}</div>
                    <div class="skill-source-block">
                      <button class="skill-source-toggle" @click.stop="openSkillDoc(skill.name)"><el-icon><Document /></el-icon> 查看技能文档</button>
                    </div>
                    <div v-if="expandedSkillTools.length > 0" class="skill-tools-section">
                      <div class="skill-tools-caption"><el-icon><Reading /></el-icon> 技能参考资料 · {{ expandedSkillTools.length }} 项</div>
                      <div class="skill-tools-list skill-tools-list--card">
                        <button v-for="t in expandedSkillTools" :key="t" class="skill-tool-tag" @click.stop="openSkillReference(skill.name, t)">
                          {{ getSkillReferenceLabel(t) }}
                          <span class="skill-tool-tag-zh">{{ t }}</span>
                        </button>
                      </div>
                    </div>
                    <div v-else class="skill-row-expand-loading">暂无工具信息</div>
                  </template>
                </div>
              </div>
              <!-- 操作按钮（仅限已安装） -->
              <el-button
                v-if="skill.installed && skill.enabled"
                size="small"
                type="danger"
                plain
                :loading="togglingSkills.get(skill.name)"
                :disabled="togglingSkills.get(skill.name)"
                @click.stop="handleToggle(skill.name, false)"
                class="skill-row-btn"
              >禁用</el-button>
              <el-button
                v-else-if="skill.installed && !skill.enabled"
                size="small"
                type="success"
                plain
                :loading="togglingSkills.get(skill.name)"
                :disabled="togglingSkills.get(skill.name)"
                @click.stop="handleToggle(skill.name, true)"
                class="skill-row-btn"
              >启用</el-button>
              <span v-else class="skill-uninstalled-label">未安装</span>
            </div>
          </div>
        </template>
      </el-scrollbar>
    </div>

    <!-- ══ 对比 tab ══ -->
    <div v-else-if="activeTab === 'compare' && skillsData" class="compare-section">
      <div v-if="agentsConfigured.length === 0" class="compare-empty">
        <el-empty description="暂无可对比的 Agent" :image-size="60" />
      </div>
      <template v-else>
        <!-- 顶部图例（固定，始终可见） -->
        <div class="compare-legend compare-legend--top">
          <span class="compare-legend-title">图例：</span>
          <span class="compare-legend-item">
            <span class="compare-dot compare-dot--enabled" />
            <span class="compare-legend-text">已激活（agent 可用）</span>
          </span>
          <span class="compare-legend-item">
            <span class="compare-dot compare-dot--inactive" />
            <span class="compare-legend-text">已安装未激活</span>
          </span>
          <span class="compare-legend-item">
            <span class="compare-dot compare-dot--absent" />
            <span class="compare-legend-text">未配置</span>
          </span>
        </div>
      <el-scrollbar class="compare-scrollbar">
        <!-- 列标题行 -->
        <div class="compare-header">
          <div class="compare-skill-col">技能</div>
          <div
            v-for="ag in agentsConfigured"
            :key="ag.id"
            class="compare-agent-col"
            :title="ag.name"
          >{{ shortAgentName(ag.name || ag.id) }}</div>
        </div>
        <!-- 分组行 -->
        <template v-for="(skills, catName) in compareSkillsByCategory" :key="catName">
          <div class="compare-cat-row">
            <el-icon class="compare-cat-icon"><component :is="getCategoryIcon(String(catName))" /></el-icon>
            {{ catName }}
          </div>
          <div
            v-for="skillName in skills"
            :key="skillName"
            class="compare-row"
          >
            <div class="compare-skill-col">
              <span class="compare-skill-name">{{ getSkillDisplayName(skillName) }}</span>
              <span class="compare-skill-id">{{ getSkillCategory(skillName) }}</span>
            </div>
            <div
              v-for="ag in agentsConfigured"
              :key="ag.id"
              class="compare-agent-col"
            >
              <span
                :class="['compare-dot', `compare-dot--${compareStatus(skillName, ag.id)}`]"
                :title="compareDotTitle(skillName, ag.id)"
              />
            </div>
          </div>
        </template>
      </el-scrollbar>
      </template>
    </div>

    <!-- ══ ClawHub 搜索模式 ══ -->
    <div v-else-if="activeTab === 'clawhub'" class="clawhub-search-section">
      <el-input
        v-model="searchQuery"
        placeholder="搜索技能..."
        @keyup.enter="handleSearch"
        prefix-icon="Search"
        class="clawhub-search-input"
      >
        <template #append>
          <el-button @click="handleSearch">搜索</el-button>
        </template>
      </el-input>

      <el-scrollbar v-if="hasSearched" class="clawhub-scrollbar" view-class="clawhub-results-scroll">
        <div class="clawhub-results">
          <div v-if="searching" class="clawhub-loading">
            <el-icon :size="20" class="is-loading"><Loading /></el-icon>
            <span>搜索中...</span>
          </div>
          <div v-else-if="searchResults.length === 0" class="clawhub-empty">
            <el-empty description="未找到相关技能" :image-size="60" />
          </div>
          <div v-else class="skills-grid">
            <el-card
              v-for="skill in searchResults"
              :key="'search-' + skill.name"
              :class="['skill-card', expandedSkillName === skill.name ? 'skill-card--expanded' : '']"
              shadow="hover"
              @click.stop="toggleSkillExpand(skill.name)"
            >
              <div class="skill-status-badges">
                <el-button
                  v-if="!skill.installed"
                  size="small"
                  type="primary"
                  plain
                  @click.stop="handleInstall(skill.name)"
                  :loading="installingSkills.get(skill.name)"
                  :disabled="installingSkills.get(skill.name)"
                  class="install-skill-btn"
                >
                  <template #icon><el-icon><Download /></el-icon></template>
                  安装
                </el-button>
                <span v-else class="status-badge badge-enabled"><el-icon><CircleCheck /></el-icon> 已安装</span>
              </div>
              <div class="skill-card-inner">
                <div class="skill-icon-wrap">
                  <img class="skill-logo-img" :src="getSkillLogoSrc(skill.name)" :alt="getSkillDisplayName(skill.name)" />
                </div>
                <div class="skill-info">
                  <div class="skill-name-row">
                  <span class="skill-name">{{ getSkillDisplayName(skill.name) }}</span>
                </div>
                  <div class="skill-id-row">{{ getSkillCategory(skill.name) }}</div>
                  <div class="skill-meta-row">
                    <span>{{ skill.name }}</span>
                    <span>{{ skill.installed ? '已安装' : '未安装' }}</span>
                    <span :class="['skill-source-badge', `skill-source-badge--${getSkillSourceKind(skill)}`]" :title="getSkillSourceTitle(skill)">
                      {{ getSkillSourceText(skill) }}
                    </span>
                  </div>
                  <div class="skill-description">{{ getSkillDescription(skill.name, skill.description) }}</div>
                  <div class="skill-stats" v-if="skill.updatedAt || skill.stars !== undefined || skill.downloads !== undefined">
                    <span v-if="skill.updatedAt" class="stat-item"><el-icon><Calendar /></el-icon> {{ formatDate(skill.updatedAt) }}</span>
                    <span v-if="skill.stars !== undefined" class="stat-item"><el-icon><Star /></el-icon> {{ skill.stars }}</span>
                    <span v-if="skill.downloads !== undefined" class="stat-item"><el-icon><Download /></el-icon> {{ skill.downloads }}</span>
                  </div>
                  <div v-if="expandedSkillName === skill.name" class="skill-card-detail" @click.stop>
                    <div v-if="expandedSkillLoading" class="skill-row-expand-loading">加载中...</div>
                    <template v-else>
                      <div class="skill-detail-summary">{{ getExpandedSkillSummary(skill.name) }}</div>
                      <div class="skill-source-block">
                        <button class="skill-source-toggle" @click.stop="openSkillDoc(skill.name)"><el-icon><Document /></el-icon> 查看技能文档</button>
                      </div>
                      <div v-if="expandedSkillTools.length > 0" class="skill-tools-section">
                        <div class="skill-tools-caption"><el-icon><Reading /></el-icon> 技能参考资料 · {{ expandedSkillTools.length }} 项</div>
                        <div class="skill-tools-list skill-tools-list--card">
                          <button v-for="t in expandedSkillTools" :key="t" class="skill-tool-tag" @click.stop="openSkillReference(skill.name, t)">
                            {{ getSkillReferenceLabel(t) }}
                            <span class="skill-tool-tag-zh">{{ t }}</span>
                          </button>
                        </div>
                      </div>
                      <div v-else class="skill-row-expand-loading">暂无工具信息</div>
                    </template>
                  </div>
                </div>
              </div>
            </el-card>
          </div>
        </div>
      </el-scrollbar>

      <div v-else class="clawhub-hint">
        <el-icon :size="40" class="clawhub-hint-icon"><Search /></el-icon>
        <p class="clawhub-hint-text">在上方输入关键词搜索 ClawHub 技能</p>
      </div>
    </div>

    <!-- ══ 技能卡片列表（已激活 / 未激活 / 未安装 tab）带分类 ══ -->
    <el-scrollbar
      v-else-if="skillsData?.skills.length && activeTab !== 'clawhub' && activeTab !== 'byAgent' && activeTab !== 'usage'"
      class="skills-scrollbar"
    >
      <template v-for="(catSkills, catName) in filteredSkillsByCategory" :key="catName">
        <div class="category-header" @click="toggleCatMain(String(catName))">
          <el-icon class="category-icon"><component :is="getCategoryIcon(String(catName))" /></el-icon>
          <span class="category-name">{{ catName }}</span>
          <span class="category-count">{{ catSkills.length }}</span>
          <span class="category-chevron" :class="{ collapsed: collapsedCatsMain.has(String(catName)) }">▾</span>
        </div>
        <div v-show="!collapsedCatsMain.has(String(catName))" class="skills-grid">
            <el-card
              v-for="skill in catSkills"
              :key="skill.name"
              :class="['skill-card', expandedSkillName === skill.name ? 'skill-card--expanded' : '']"
              shadow="hover"
              @click.stop="toggleSkillExpand(skill.name)"
            >
            <div class="skill-status-badges">
              <div class="install-btn-group">
                <el-button
                  v-if="!skill.installed"
                  size="small"
                  type="primary"
                  plain
                  @click.stop="handleInstall(skill)"
                  :loading="installingSkills.get(skill.name)"
                  :disabled="installingSkills.get(skill.name)"
                  class="install-skill-btn"
                >
                  <template #icon><el-icon><Download /></el-icon></template>
                  安装
                </el-button>
              </div>
              <template v-if="skill.installed">
                <el-button
                  v-if="skill.enabled"
                  size="small"
                  type="danger"
                  @click.stop="handleToggle(skill.name, false)"
                  :loading="togglingSkills.get(skill.name)"
                  :disabled="togglingSkills.get(skill.name)"
                  class="toggle-skill-btn"
                >
                  禁用
                </el-button>
                <el-button
                  v-else
                  size="small"
                  type="success"
                  @click.stop="handleToggle(skill.name, true)"
                  :loading="togglingSkills.get(skill.name)"
                  :disabled="togglingSkills.get(skill.name)"
                  class="toggle-skill-btn"
                >
                  启用
                </el-button>
              </template>
            </div>

            <div class="skill-card-inner">
              <div class="skill-icon-wrap">
                <img class="skill-logo-img" :src="getSkillLogoSrc(skill.name)" :alt="getSkillDisplayName(skill.name)" />
              </div>
              <div class="skill-info">
                <div class="skill-name-row">
                  <span class="skill-name">{{ getSkillDisplayName(skill.name) }}</span>
                  <el-tag
                    v-if="skill.status"
                    :type="getStatusType(skill.status)"
                    size="small"
                    class="skill-status-tag"
                  >
                    {{ skill.status }}
                  </el-tag>
                </div>
                <div class="skill-id-row">{{ getSkillCategory(skill.name) }}</div>
                <div class="skill-meta-row">
                  <span>{{ skill.name }}</span>
                  <span>{{ getSkillStatusLabel(skill) }}</span>
                  <span :class="['skill-source-badge', `skill-source-badge--${getSkillSourceKind(skill)}`]" :title="getSkillSourceTitle(skill)">
                    {{ getSkillSourceText(skill) }}
                  </span>
                </div>
                <div class="skill-description">{{ getSkillDescription(skill.name) }}</div>
                <div v-if="expandedSkillName === skill.name" class="skill-card-detail" @click.stop>
                  <div v-if="expandedSkillLoading" class="skill-row-expand-loading">加载中...</div>
                  <template v-else>
                    <div class="skill-detail-summary">{{ getExpandedSkillSummary(skill.name) }}</div>
                    <div class="skill-source-block">
                      <button class="skill-source-toggle" @click.stop="openSkillDoc(skill.name)"><el-icon><Document /></el-icon> 查看技能文档</button>
                    </div>
                    <div v-if="expandedSkillTools.length > 0" class="skill-tools-section">
                      <div class="skill-tools-caption"><el-icon><Reading /></el-icon> 技能参考资料 · {{ expandedSkillTools.length }} 项</div>
                      <div class="skill-tools-list skill-tools-list--card">
                        <button v-for="t in expandedSkillTools" :key="t" class="skill-tool-tag" @click.stop="openSkillReference(skill.name, t)">
                          {{ getSkillReferenceLabel(t) }}
                          <span class="skill-tool-tag-zh">{{ t }}</span>
                        </button>
                      </div>
                    </div>
                    <div v-else class="skill-row-expand-loading">暂无工具信息</div>
                  </template>
                </div>
              </div>
            </div>
          </el-card>
        </div>
      </template>
    </el-scrollbar>

    <!-- 空状态 -->
    <el-empty v-else-if="!loading && skillsData?.skills.length === 0" description="暂无技能" :image-size="80" />
    <el-empty v-else-if="!loading && !skillsData" description="加载失败，请重试" :image-size="80">
      <el-button type="primary" @click="fetchSkills">重新加载</el-button>
    </el-empty>
  </el-dialog>

  <!-- ══ 技能文档弹窗（独立页面，markdown 渲染，阅读舒适）══ -->
  <el-dialog
    v-model="skillDocVisible"
    width="780px"
    top="6vh"
    class="skill-doc-dialog"
    :append-to-body="true"
    destroy-on-close
  >
    <template #header>
      <div class="skill-doc-head">
        <el-icon class="skill-doc-head-icon"><Document /></el-icon>
        <div class="skill-doc-head-text">
          <div class="skill-doc-head-title">
            {{ skillDocTitle }}
            <span v-if="skillDocHasTranslation && !skillDocShowOriginal" class="skill-doc-badge zh">中文译文</span>
            <span v-else-if="skillDocHasTranslation" class="skill-doc-badge en">英文原文</span>
            <span v-else-if="skillDocAlreadyChinese" class="skill-doc-badge zh">中文文档</span>
            <span v-else class="skill-doc-badge none">英文原文（暂无译文）</span>
          </div>
          <div class="skill-doc-head-sub">{{ skillDocSubtitle }}</div>
          <div v-if="skillDocSourceText" :class="['skill-doc-source', `skill-source-badge--${skillDocSourceKind}`]" :title="skillDocSourceTitle">
            来源：{{ skillDocSourceText }}
          </div>
        </div>
        <button
          v-if="skillDocHasTranslation"
          class="skill-doc-toggle-btn"
          @click="skillDocShowOriginal = !skillDocShowOriginal"
        ><el-icon><Refresh /></el-icon> {{ skillDocShowOriginal ? '显示中文译文' : '显示英文原文' }}</button>
      </div>
    </template>
    <div v-if="skillDocLoading" class="skill-doc-loading">正在加载技能文档…</div>
    <el-scrollbar v-else height="74vh">
      <div class="markdown-body skill-doc-body" v-html="skillDocHtml" />
      <div v-if="!skillDocContent && !skillDocTranslated" class="skill-doc-empty">该技能没有 SKILL.md 文档内容</div>
    </el-scrollbar>
  </el-dialog>

  <!-- ══ 使用统计详情：点击排行榜/未使用项后查看中文说明和原始标识 ══ -->
  <el-dialog
    v-model="usageToolVisible"
    width="640px"
    top="10vh"
    class="usage-detail-dialog"
    :append-to-body="true"
    destroy-on-close
  >
    <template #header>
      <div class="usage-detail-head">
        <img
          class="skill-logo-img usage-detail-logo"
          :src="getSkillLogoSrc(usageToolItem?.name || '')"
          :alt="usageToolTitle"
        />
        <div class="usage-detail-title-wrap">
          <div class="usage-detail-title">{{ usageToolTitle }}</div>
          <div class="usage-detail-sub">{{ usageToolCategory }} · {{ usageToolStatus }}</div>
        </div>
        <button class="skill-doc-toggle-btn" @click="usageToolShowOriginal = !usageToolShowOriginal">
          <el-icon><Refresh /></el-icon> {{ usageToolShowOriginal ? '显示中文说明' : '显示原始标识' }}
        </button>
      </div>
    </template>
    <div v-if="usageToolItem" class="usage-detail-body">
      <div class="usage-detail-metrics">
        <div>
          <span>调用次数</span>
          <strong>{{ usageToolItem.total.toLocaleString() }}</strong>
        </div>
        <div>
          <span>参与 Agent</span>
          <strong>{{ usageToolAgents.length }}</strong>
        </div>
        <div>
          <span>统计范围</span>
          <strong>近 {{ usageDays }} 天</strong>
        </div>
      </div>

      <div class="usage-detail-section">
        <h4>{{ usageToolShowOriginal ? '原始信息' : '中文说明' }}</h4>
        <div v-if="usageToolShowOriginal" class="usage-detail-raw">
          <div><span>原始名称</span><code>{{ usageToolItem.name }}</code></div>
          <div><span>分类</span><code>{{ usageToolCategory }}</code></div>
          <div><span>状态</span><code>{{ usageToolStatus }}</code></div>
        </div>
        <p v-else class="usage-detail-desc">{{ usageToolDescription }}</p>
      </div>

      <div class="usage-detail-section">
        <h4>哪些 Agent 调用过</h4>
        <div class="usage-detail-agents">
          <div v-for="agent in usageToolAgents" :key="agent.id" class="usage-detail-agent">
            <img :src="getAgentAvatar(agent.id)" :alt="agent.name" @error="setDefaultAvatar" />
            <div>
              <strong>{{ agent.name }}</strong>
              <span>{{ agent.count.toLocaleString() }} 次</span>
            </div>
          </div>
        </div>
      </div>

      <div class="usage-detail-actions">
        <button
          v-if="usageToolHasSkillDoc"
          class="skill-source-toggle"
          @click="openSkillDoc(usageToolItem.name)"
        >
          <el-icon><Document /></el-icon> 查看 skill 详情
        </button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { marked } from 'marked'
import { renderSafeMarkdown } from '../utils/safe-content.mjs'
import { getSkills, installSkill, searchClawHubSkills, toggleSkill, type SkillsResponse, type SkillInfo } from '../api/system'
import { ElMessage } from 'element-plus'
import { setDefaultAvatar } from '../utils/avatarFallback'
import { normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'
import { createSafeRecord, ownValue } from '../utils/safe-record.mjs'
import {
  Loading,
  Download,
  Refresh,
  Search,
  TrendCharts,
  List,
  Document,
  Reading,
  CircleCheck,
  Calendar,
  Star,
  ChatDotRound,
  Tools,
  Odometer,
  Message,
  DataAnalysis,
  Lock,
  MoreFilled,
} from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  visible: boolean
}>(), {
  visible: false
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

// ── 状态 ──────────────────────────────────────────────────
const loading = ref(false)
const skillsData = ref<SkillsResponse | null>(null)
const installingSkills = ref<Map<string, boolean>>(new Map())
const togglingSkills = ref<Map<string, boolean>>(new Map())
const activeTab = ref('activated')
const searchQuery = ref('')
const searchResults = ref<SkillInfo[]>([])
const searching = ref(false)
const hasSearched = ref(false)

// ── 技能详情展开 ──────────────────────────────────────────
const expandedSkillName = ref('')
const expandedSkillTools = ref<string[]>([])
const expandedSkillLoading = ref(false)
interface SkillDetail {
  name: string
  description: string
  content: string
  tools: string[]
}
const skillDetailCache = ref<Record<string, SkillDetail>>(createSafeRecord())

// 分类折叠状态（用 Set 存储已折叠的分类名）
const collapsedCatsMain = ref<Set<string>>(new Set())
const collapsedCatsAgent = ref<Set<string>>(new Set())
function toggleCatMain(cat: string) {
  const s = new Set(collapsedCatsMain.value)
  s.has(cat) ? s.delete(cat) : s.add(cat)
  collapsedCatsMain.value = s
}
function toggleCatAgent(cat: string) {
  const s = new Set(collapsedCatsAgent.value)
  s.has(cat) ? s.delete(cat) : s.add(cat)
  collapsedCatsAgent.value = s
}

async function toggleSkillExpand(skillName: string): Promise<void> {
  if (expandedSkillName.value === skillName) {
    expandedSkillName.value = ''
    return
  }
  expandedSkillName.value = skillName
  const cached = ownValue(skillDetailCache.value, skillName)
  if (cached) {
    expandedSkillTools.value = cached.tools || []
    return
  }
  expandedSkillTools.value = []
  expandedSkillLoading.value = true
  try {
    const resp = await fetch(`/api/system/skill-readme?name=${encodeURIComponent(skillName)}`)
    if (resp.ok) {
      const data = await resp.json()
      const detail: SkillDetail = {
        name: skillName,
        description: String(data.description || ''),
        content: String(data.content || ''),
        tools: Array.isArray(data.tools) ? data.tools : [],
      }
      skillDetailCache.value[skillName] = detail
      expandedSkillTools.value = detail.tools
    }
  } catch (_) { /* ignore */ }
  finally { expandedSkillLoading.value = false }
}

// ── 按 Agent tab 状态 ────────────────────────────────────
interface AgentConfigured {
  id: string
  name: string
  emoji: string
  avatar?: string
  skills: string[]
  model: string
  skillsUnconstrained?: boolean
}
const agentsConfigured = ref<AgentConfigured[]>([])
const selectedAgentId = ref<string>('')

// ── 技能中文显示名 ────────────────────────────────────────
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'lark-im': '飞书即时通讯',
  'lark-task': '飞书任务',
  'lark-calendar': '飞书日历',
  'lark-doc': '飞书文档',
  'lark-wiki': '飞书知识库',
  'lark-base': '飞书多维表格',
  'lark-sheets': '飞书电子表格',
  'lark-drive': '飞书云盘',
  'lark-contact': '飞书通讯录',
  'lark-mail': '飞书邮件',
  'lark-approval': '飞书审批',
  'lark-attendance': '飞书考勤',
  'lark-event': '飞书活动',
  'lark-minutes': '飞书会议纪要',
  'lark-okr': '飞书 OKR',
  'lark-slides': '飞书幻灯片',
  'lark-vc': '飞书视频会议',
  'lark-vc-agent': '飞书视会助手',
  'lark-whiteboard': '飞书白板',
  'lark-shared': '飞书共享资源',
  'lark-apps': '飞书妙搭部署',
  'lark-markdown': '飞书 Markdown',
  'lark-workflow-meeting-summary': '会议总结工作流',
  'lark-workflow-standup-report': '站会报告工作流',
  'lark-openapi-explorer': '飞书开放平台浏览器',
  'lark-skill-maker': '技能制作器',
  'feishu-toolkit': '飞书工具包',
  'feishu-doc': '飞书文档（增强）',
  'feishu-wiki': '飞书知识库（增强）',
  'feishu-drive': '飞书云盘（增强）',
  'feishu-perm': '飞书权限管理',
  'jw-feishu-suite': '嘉维飞书套件',
  'Feishu All-in-One': '飞书全能套件',
  'diagram-maker': '流程图绘制',
  'browser-automation': '浏览器自动化',
  'python-debugpy': 'Python 调试',
  'node-inspect-debugger': 'Node.js 调试',
  'spike': '技术调研工具',
  'weather': '天气查询',
  'canvas': '画布工具',
  '1password': '密码管理器',
  'apple-notes': 'Apple 备忘录',
  'apple-reminders': 'Apple 提醒事项',
  'lark-approval-extra': '飞书审批（扩展）',
  'Feishu Task Daily Summary': '飞书任务每日汇总',
  'healthcheck': '主机安全巡检',
  'bear-notes': '熊记笔记',
  'blogwatcher': '博客订阅监控',
  'blucli': 'BluOS 音响控制',
  'camsnap': '摄像头抓拍',
  'clawhub': 'ClawHub 技能管理',
  'coding-agent': '编码代理委派',
  'discord': 'Discord 消息',
  'eightctl': 'Eight Sleep 控制',
  'gemini': 'Gemini 命令行',
  'gh-issues': 'GitHub Issue 管理',
  'gifgrep': 'GIF 搜索',
  'github': 'GitHub 工具',
  'gog': 'Google Workspace 工具',
  'goplaces': 'Google 地点查询',
  'himalaya': 'Himalaya 邮件工具',
  'imsg': 'iMessage 消息',
  'mcporter': 'MCP 转接器',
  'model-usage': '模型用量统计',
  'adaptyv': '蛋白实验平台',
  'aeon': '时间序列机器学习',
  'anndata': '单细胞矩阵数据',
  'arboreto': '基因调控网络推断',
  'astropy': '天文数据工具',
  'autoskill': '自动技能发现',
  'benchling-integration': 'Benchling 研发平台',
  'bgpt-paper-search': '科研论文结构化检索',
  'biopython': '生物序列工具',
  'bioservices': '生物数据库服务',
  'cellxgene-census': '单细胞图谱查询',
  'cirq': '量子电路工具',
  'citation-management': '文献引用管理',
  'clinical-decision-support': '临床决策支持',
  'clinical-reports': '临床报告生成',
  'cobrapy': '代谢网络建模',
  'consciousness-council': '多视角思考委员会',
  'dask': '分布式数据计算',
  'database-lookup': '公共数据库查询',
  'datamol': '分子数据处理',
  'deepchem': '分子机器学习',
  'deeptools': '测序数据可视化',
  'depmap': '癌症依赖图谱',
  'dhdna-profiler': '认知模式画像',
  'diffdock': '分子对接预测',
  'dnanexus-integration': 'DNAnexus 云基因组平台',
  'docx': 'Word 文档处理',
  'esm': '蛋白语言模型',
  'etetoolkit': '系统发育树工具',
  'exa-search': '高质量网页检索',
  'exploratory-data-analysis': '探索性数据分析',
  'flowio': '流式细胞数据解析',
  'fluidsim': '流体仿真',
  'generate-image': '图像生成',
  'geniml': '基因组区间机器学习',
  'geomaster': '地理空间分析',
  'geopandas': '地理矢量数据处理',
  'get-available-resources': '计算资源探测',
  'gget': '生物信息快速查询',
  'ginkgo-cloud-lab': 'Ginkgo 云实验室',
  'glycoengineering': '糖基化工程',
  'gtars': '基因组区间分析',
  'histolab': '病理切片处理',
  'hugging-science': '科研模型与数据集',
  'hypogenic': '自动假设生成',
  'hypothesis-generation': '科学假设生成',
  'image-generate': '图片生成脚本',
  'imaging-data-commons': '癌症影像数据库',
  'infographics': '信息图生成',
  'lark-voice': '飞书语音消息',
  'markdown-mermaid-writing': 'Markdown 图文写作',
  'markitdown': '文件转 Markdown',
  'node-connect': '设备节点连接诊断',
  'openai-whisper': '本地语音转文字',
  'pdf': 'PDF 文件处理',
  'pptx': 'PPT 演示文稿处理',
  'research-lookup': '联网资料检索',
  'skill-creator': '技能创建助手',
  'taskflow': '多步任务编排',
  'taskflow-inbox-triage': '收件箱分流示例',
  'xlsx': 'Excel 表格处理',
}

// ── 技能中文描述 ──────────────────────────────────────────
const SKILL_DESCRIPTIONS: Record<string, string> = {
  'lark-im': '发送消息、创建群组、管理对话和频道',
  'lark-task': '创建、分配、追踪任务，管理项目进度',
  'lark-calendar': '查看和管理日程，创建会议邀请',
  'lark-doc': '读写飞书文档，创建和编辑富文本内容',
  'lark-wiki': '管理知识库页面，查询和发布知识文章',
  'lark-base': '操作多维表格数据库，读写结构化数据',
  'lark-sheets': '读写电子表格，执行数据计算与分析',
  'lark-drive': '文件管理与上传下载，搜索云盘内容',
  'lark-contact': '查询用户信息和部门结构，获取员工通讯录',
  'lark-mail': '发送和管理邮件，设置邮件签名',
  'lark-approval': '发起和处理审批流程，查看审批进度',
  'lark-attendance': '查询和管理考勤数据，处理打卡记录',
  'lark-event': '管理活动和报名，创建线上线下活动',
  'lark-minutes': '生成和管理会议纪要，整理会议决议',
  'lark-okr': '管理目标与关键结果，追踪 OKR 进展',
  'lark-slides': '创建和编辑演示文稿，生成 PPT',
  'lark-vc': '发起和管理视频会议，查询会议室',
  'lark-vc-agent': '视频会议 AI 助理，会中实时辅助',
  'lark-whiteboard': '协作绘制白板，创建思维导图',
  'lark-shared': '管理共享文件和协作内容',
  'lark-apps': '将本地 HTML 文件或目录部署到飞书妙搭，生成公网可访问链接；管理应用共享范围',
  'lark-markdown': '以 Markdown 格式创建飞书文档',
  'lark-workflow-meeting-summary': '自动提取会议录音，生成结构化会议摘要',
  'lark-workflow-standup-report': '汇总任务进展，自动生成站会报告',
  'lark-openapi-explorer': '探索和测试飞书开放平台 API',
  'lark-skill-maker': '创建和发布自定义技能',
  'feishu-toolkit': '通用飞书操作工具集，包含常用飞书 API 封装',
  'feishu-doc': '高级文档操作，支持更多格式和功能',
  'feishu-wiki': '高级知识库操作，支持树状结构管理',
  'feishu-drive': '高级文件操作，支持批量处理和权限管理',
  'feishu-perm': '管理文件、文档和知识库的访问权限',
  'jw-feishu-suite': '嘉维扩展飞书功能，提供定制化业务能力',
  'Feishu All-in-One': '整合所有飞书功能的全能套件',
  'diagram-maker': '创建流程图、架构图和 UML 图，支持多种图表类型',
  'browser-automation': '控制浏览器完成网页操作，抓取网页内容',
  'python-debugpy': '调试 Python 代码，支持断点、变量查看和异常追踪',
  'node-inspect-debugger': '调试 JavaScript/TypeScript 代码，支持 Node.js 调试协议',
  'spike': '快速验证技术方案可行性，进行技术调研与原型测试',
  'weather': '获取实时天气信息和未来天气预报',
  'canvas': '创建可视化图形内容，生成图像和设计资产',
  '1password': '安全访问密码管理器中的凭据和机密',
  'apple-notes': '读写系统备忘录，管理笔记内容',
  'apple-reminders': '创建和管理系统提醒事项',
  'lark-approval-extra': '扩展版飞书审批，支持自定义表单字段、条件分支和多级审批人配置',
  'Feishu Task Daily Summary': '读取飞书任务清单，筛选未完成任务，生成每日待办汇总；支持创建、修改、关闭和归档任务',
  'healthcheck': '对 OpenClaw 主机进行安全审计：检查 SSH 配置、防火墙规则、系统更新、磁盘加密及备份状态',
  'bear-notes': '通过 Bear 笔记命令行创建、搜索和管理本机笔记',
  'blogwatcher': '监控博客和 RSS/Atom 订阅源，发现更新并生成提醒',
  'blucli': '发现、播放、分组和调节 BluOS 音响设备',
  'camsnap': '从 RTSP/ONVIF 摄像头抓取画面或短视频片段',
  'clawhub': '搜索、安装、更新、同步和发布 OpenClaw Agent 技能',
  'coding-agent': '把编码任务委派给 Codex、Claude Code 或其他后台编码代理',
  'discord': '发送、读取、编辑、删除 Discord 消息，并处理反应、投票和线程',
  'eightctl': '查看和控制 Eight Sleep 睡眠设备的状态、温度、闹钟和计划',
  'gemini': '调用 Gemini 命令行完成一次性提示、总结、生成和技能路由',
  'gh-issues': '拉取 GitHub Issue，筛选候选项，派发修复代理并创建 PR',
  'gifgrep': '搜索 GIF 提供商，下载结果并提取静态帧或图集',
  'github': '处理 GitHub Issue、PR、CI 日志、评论、发布和仓库操作',
  'gog': '管理 Gmail、日历、云端硬盘、通讯录、表格和文档',
  'goplaces': '查询 Google 地点搜索、详情、评论和结构化位置数据',
  'himalaya': '通过 IMAP/SMTP 读取、搜索、撰写、回复、转发和整理邮件',
  'imsg': '读取 iMessage/SMS 会话历史，并通过系统消息应用发送消息',
  'mcporter': '导入、整理和转接 MCP 服务配置',
  'model-usage': '统计模型 Token、费用、输入输出拆分和使用趋势',
  'adaptyv': '对接蛋白实验平台，提交蛋白序列实验并读取结果',
  'aeon': '处理时间序列分类、回归、聚类、预测和异常检测任务',
  'anndata': '读取和处理单细胞分析中的 h5ad 注释矩阵数据',
  'arboreto': '从基因表达数据推断转录因子与靶基因调控关系',
  'astropy': '处理天文坐标、FITS 文件、宇宙学计算和天文数据分析',
  'autoskill': '观察重复工作流，识别可沉淀为 OpenClaw 技能的模式',
  'benchling-integration': '连接 Benchling 注册库、库存、电子实验记录和工作流',
  'bgpt-paper-search': '检索论文全文中的实验方法、样本量、结果和结论等结构化字段',
  'biopython': '处理 FASTA、GenBank、PDB、BLAST 和 NCBI 查询等生物序列任务',
  'bioservices': '统一查询 UniProt、KEGG、ChEMBL、Reactome 等生物信息服务',
  'cellxgene-census': '查询大规模单细胞图谱中的组织、疾病和细胞类型表达数据',
  'cirq': '构建、模拟和分析面向 Google 量子硬件的量子电路',
  'citation-management': '检索文献、验证元数据，并生成规范 BibTeX 引用',
  'clinical-decision-support': '生成临床研究和药物开发场景的决策支持文档',
  'clinical-reports': '生成病例、诊断、临床试验和患者记录等专业报告',
  'cobrapy': '进行约束代谢建模、通量平衡分析和基因敲除模拟',
  'consciousness-council': '组织多角色观点讨论，用于复杂决策和创意推演',
  'dask': '把 pandas/NumPy 工作流扩展到并行或大于内存的数据处理',
  'database-lookup': '查询科学、医学、材料、经济等公共数据库 API',
  'datamol': '标准化分子、计算描述符、指纹、聚类和三维构象',
  'deepchem': '训练和评估分子属性预测、毒性和 ADMET 机器学习模型',
  'deeptools': '进行 ChIP-seq、RNA-seq、ATAC-seq 等测序数据质控和热图分析',
  'depmap': '查询癌症细胞系基因依赖、药物敏感性和靶点脆弱性数据',
  'dhdna-profiler': '从文本中提取思维方式、认知风格和决策模式',
  'diffdock': '预测蛋白-配体结合姿态并评估分子对接置信度',
  'dnanexus-integration': '构建和运行 DNAnexus 云基因组工作流，管理测序数据',
  'docx': '创建、读取、编辑和格式化 Word 文档',
  'esm': '使用蛋白语言模型生成、嵌入和分析蛋白序列与结构',
  'etetoolkit': '读取、操作和可视化系统发育树与物种分类数据',
  'exa-search': '面向科研和技术内容执行语义网页检索和网页提取',
  'exploratory-data-analysis': '自动识别科学数据文件格式并生成结构、质量和建议报告',
  'flowio': '解析流式细胞 FCS 文件，提取事件矩阵和通道元数据',
  'fluidsim': '运行 Navier-Stokes、浅水方程和湍流等流体动力学仿真',
  'generate-image': '生成照片、插画、视觉资产和概念图',
  'geniml': '对 BED 等基因组区间数据进行机器学习和嵌入训练',
  'geomaster': '处理遥感、GIS、空间统计、地形和地理机器学习任务',
  'geopandas': '读取、转换、叠加、裁剪和分析地理矢量数据',
  'get-available-resources': '探测 CPU、GPU、内存和磁盘资源，为计算任务选择策略',
  'gget': '快速查询基因、蛋白、BLAST、AlphaFold 和富集分析信息',
  'ginkgo-cloud-lab': '提交和管理 Ginkgo 云实验室协议与自动化实验',
  'glycoengineering': '分析和设计蛋白糖基化位点、热点和相关工程方案',
  'gtars': '高性能处理基因组区间、覆盖度、重叠和片段数据',
  'histolab': '从全切片病理图像中提取组织区域和训练切片',
  'hugging-science': '发现并使用科研领域的 Hugging Face 数据集、模型和演示空间',
  'hypogenic': '结合文献和数据自动提出并测试经验假设',
  'hypothesis-generation': '把观察结果转化为可检验假设、预测和实验方案',
  'image-generate': '使用本地脚本生成图片素材',
  'imaging-data-commons': '查询和下载 NCI 癌症影像公共数据集',
  'infographics': '生成专业信息图，并进行自动质量检查和迭代',
  'lark-voice': '把文字转成语音，在飞书里发送语音消息',
  'markdown-mermaid-writing': '撰写 Markdown 文档并绘制 Mermaid 流程图与图表',
  'markitdown': '把 PDF、Word、PPT、Excel、图片等文件转换成 Markdown',
  'node-connect': '诊断手机、电脑与 OpenClaw 的配对、扫码和连接故障',
  'openai-whisper': '在本地把语音转成文字，无需联网或 API 密钥',
  'pdf': '读取、提取、拆分、合并和处理 PDF 文件内容',
  'pptx': '创建、读取和编辑 PPT 演示文稿',
  'research-lookup': '联网搜索最新资料、论文和实时信息',
  'skill-creator': '创建、编辑、校验和整理 OpenClaw 技能与 SKILL.md 文件',
  'taskflow': '把多步骤长任务编排成一个可持久跟踪、可等待的作业',
  'taskflow-inbox-triage': '收件箱分流、意图路由和回复等待的示例流程',
  'xlsx': '创建、读取和编辑 Excel 电子表格文件',
}

// ── 技能分类 ──────────────────────────────────────────────
const SKILL_CATEGORIES: Record<string, string[]> = {
  '飞书协作': [
    'lark-im', 'lark-task', 'lark-calendar', 'lark-doc', 'lark-wiki',
    'lark-base', 'lark-sheets', 'lark-drive', 'lark-contact', 'lark-mail',
    'lark-approval', 'lark-attendance', 'lark-event', 'lark-minutes', 'lark-okr',
    'lark-slides', 'lark-vc', 'lark-vc-agent', 'lark-whiteboard', 'lark-shared',
    'lark-apps', 'lark-markdown', 'lark-workflow-meeting-summary', 'lark-workflow-standup-report',
    'lark-openapi-explorer', 'lark-skill-maker', 'lark-voice',
    'feishu-toolkit', 'feishu-doc', 'feishu-wiki', 'feishu-drive', 'feishu-perm',
    'jw-feishu-suite', 'Feishu All-in-One',
  ],
  '开发工具': [
    'browser-automation', 'python-debugpy', 'node-inspect-debugger', 'spike',
    'coding-agent', 'github', 'gh-issues', 'clawhub', 'mcporter',
    'skill-creator', 'taskflow', 'taskflow-inbox-triage', 'node-connect',
  ],
  '生产力工具': [
    'diagram-maker', 'canvas', 'weather', 'apple-notes', 'apple-reminders',
    'Feishu Task Daily Summary', 'bear-notes', 'blogwatcher', 'gifgrep',
    'generate-image', 'image-generate', 'infographics',
    'markdown-mermaid-writing', 'research-lookup',
  ],
  '办公与消息': [
    'discord', 'gog', 'goplaces', 'himalaya', 'imsg', 'docx',
    'pdf', 'pptx', 'xlsx', 'markitdown', 'openai-whisper',
  ],
  '科研与数据': [
    'adaptyv', 'aeon', 'anndata', 'arboreto', 'astropy', 'benchling-integration',
    'bgpt-paper-search', 'biopython', 'bioservices', 'cellxgene-census',
    'cirq', 'citation-management', 'clinical-decision-support', 'clinical-reports',
    'cobrapy', 'dask', 'database-lookup', 'datamol', 'deepchem', 'deeptools',
    'depmap', 'diffdock', 'dnanexus-integration', 'esm', 'etetoolkit',
    'exploratory-data-analysis', 'flowio', 'fluidsim', 'geniml', 'geomaster',
    'geopandas', 'gget', 'ginkgo-cloud-lab', 'glycoengineering', 'gtars',
    'histolab', 'hugging-science', 'hypogenic', 'hypothesis-generation',
    'imaging-data-commons',
  ],
  '系统与安全': [
    '1password', 'healthcheck', 'autoskill', 'get-available-resources',
    'blucli', 'camsnap', 'eightctl', 'gemini', 'dhdna-profiler',
  ],
}

const CATEGORY_ICONS: Record<string, any> = {
  '飞书协作': ChatDotRound,
  '开发工具': Tools,
  '生产力工具': Odometer,
  '办公与消息': Message,
  '科研与数据': DataAnalysis,
  '系统与安全': Lock,
  '其他': MoreFilled,
}

const SKILL_TOKEN_NAMES: Record<string, string> = {
  bear: '熊记',
  notes: '笔记',
  blogwatcher: '博客订阅监控',
  blucli: 'BluOS 音响控制',
  camsnap: '摄像头抓拍',
  clawhub: 'ClawHub 技能管理',
  coding: '代码任务委派',
  agent: 'Agent',
  discord: 'Discord 消息',
  eightctl: 'Eight Sleep 控制',
  gemini: 'Gemini 命令行',
  gh: 'GitHub',
  github: 'GitHub',
  issues: 'Issue 管理',
  gifgrep: 'GIF 搜索',
  gog: 'Google Workspace',
  goplaces: 'Google 地点查询',
  himalaya: 'Himalaya 邮件',
  imsg: 'iMessage 消息',
  model: '模型',
  usage: '用量统计',
  python: 'Python',
  py: 'Python',
  apple: 'Apple',
  lark: '飞书',
  feishu: '飞书',
  approval: '审批',
  apps: '妙搭部署',
  attendance: '考勤',
  base: '多维表格',
  calendar: '日历',
  contact: '通讯录',
  doc: '文档',
  drive: '云盘',
  event: '事件',
  mail: '邮件',
  markdown: 'Markdown',
  minutes: '妙记',
  okr: 'OKR',
  openapi: 'OpenAPI',
  sheets: '电子表格',
  slides: '幻灯片',
  task: '任务',
  vc: '视频会议',
  whiteboard: '画板',
  wiki: '知识库',
  workflow: '工作流',
  standup: '站会',
  report: '报告',
  data: '数据',
  analytics: '分析',
  dashboard: '仪表盘',
  image: '图片',
  browser: '浏览器',
  control: '控制',
  documents: '文档',
  spreadsheets: '表格',
  presentations: '演示文稿',
  notion: 'Notion',
  outlook: 'Outlook 邮箱',
  email: '邮件',
  search: '搜索',
  installer: '安装器',
  creator: '创建器',
  automation: '自动化',
  weather: '天气',
  diagram: '图表',
  maker: '生成器',
  canvas: '画布',
  healthcheck: '健康检查',
  autoskill: '自动技能',
  mcporter: 'MCP 转换器',
  pdf: 'PDF',
  pptx: '演示文稿',
  xlsx: '表格',
  docx: '文档',
  gmail: 'Gmail',
  process: '进程管理',
  exec: '执行命令',
  read: '读取',
  write: '写入',
  edit: '编辑',
}

function slugToChineseName(name: string): string {
  const raw = String(name || '')
  const direct = ownValue(SKILL_TOKEN_NAMES, raw.toLowerCase())
  if (direct) return direct
  const parts = raw.split(/[:/_\-\s]+/).filter(Boolean)
  const mapped = parts.map(p => ownValue(SKILL_TOKEN_NAMES, p.toLowerCase()) || '').filter(Boolean)
  const unique = Array.from(new Set(mapped))
  if (unique.length) return unique.join(' · ')
  return `${getSkillCategory(name)}技能`
}

function getSkillDisplayName(name: string): string {
  const displayName = ownValue(SKILL_DISPLAY_NAMES, name)
  if (displayName) return displayName
  const inferred = slugToChineseName(name)
  if (inferred && !inferred.endsWith('技能')) return inferred
  const lower = name.toLowerCase()
  if (lower.includes('github') || lower.includes('gh-')) return 'GitHub 相关技能'
  if (lower.includes('google') || lower.includes('gmail') || lower.includes('gog')) return 'Google 相关技能'
  if (lower.includes('lark') || lower.includes('feishu')) return '飞书相关技能'
  if (lower.includes('bio') || lower.includes('gene') || lower.includes('protein') || lower.includes('clinical')) return '生命科学技能'
  if (lower.includes('data') || lower.includes('analysis') || lower.includes('database')) return '数据分析技能'
  if (lower.includes('image') || lower.includes('canvas') || lower.includes('diagram')) return '视觉生成技能'
  if (lower.includes('mail') || lower.includes('message') || lower.includes('discord')) return '消息协作技能'
  if (lower.includes('cli') || lower.includes('ctl')) return '命令行控制技能'
  return inferred || `${getSkillCategory(name)}技能`
}

function getSkillDescription(name: string, fallbackDescription?: string): string {
  const configuredDescription = ownValue(SKILL_DESCRIPTIONS, name)
  if (configuredDescription) return configuredDescription
  return translateSkillDescription(name, fallbackDescription || skillsData.value?.skills.find(s => s.name === name)?.description || '')
}

function translateSkillDescription(name: string, raw: string): string {
  const text = `${name} ${raw}`.toLowerCase()
  if (/bear[-_\s]?notes|bear notes|grizzly/.test(text)) return '创建、搜索和管理 Bear 笔记，适合整理个人知识和本地笔记'
  if (/blogwatcher|rss|atom/.test(text)) return '监控博客、RSS 或 Atom 订阅源，发现更新后提醒或汇总'
  if (/blucli|bluos/.test(text)) return '控制 BluOS 音频设备，支持发现设备、播放控制和分组管理'
  if (/camsnap|rtsp|onvif|camera/.test(text)) return '从 RTSP/ONVIF 摄像头抓取画面或短片，适合查看设备状态'
  if (/clawhub/.test(text)) return '搜索、安装、更新、同步或发布 OpenClaw 技能'
  if (/coding[-_\s]?agent|delegate coding|codex|claude code/.test(text)) return '把代码任务委派给子 Agent 或外部代码助手，并跟踪执行结果'
  if (/\beightctl\b|eight sleep/.test(text)) return '查看和控制 Eight Sleep 设备状态、温度和提醒'
  if (/\bgemini\b/.test(text)) return '调用 Gemini 命令行完成总结、生成、问答或一次性提示任务'
  if (/gifgrep|giphy/.test(text)) return '搜索 GIF 资源并下载结果，适合快速找动图素材'
  if (/goplaces|google places|place details|resolve place/.test(text)) return '查询 Google 地点、地点详情和地理位置解析'
  if (/himalaya|imap|smtp/.test(text)) return '通过 IMAP/SMTP 读取、搜索和发送邮件'
  if (/imsg|imessage/.test(text)) return '读取和发送 iMessage 消息，适合处理本机消息沟通'
  if (/mcp/.test(text)) return '管理或转换 MCP 工具连接，帮助技能接入外部能力'
  if (/model[-_\s]?usage|token|cost/.test(text)) return '统计模型 Token、输入输出、缓存和费用使用情况'
  if (/python|pyright|pytest|script/.test(text)) return '运行或管理 Python 脚本、测试、依赖和开发任务'
  if (/apple|macos|finder|shortcut|osascript/.test(text)) return '调用 macOS / Apple 本机能力，处理文件、快捷指令或系统自动化'
  if (/pdf/.test(text)) return '读取、生成、渲染和校验 PDF 文件，适合处理版式类文档'
  if (/spreadsheet|excel|xlsx|csv|sheet/.test(text)) return '创建、读取、分析和整理电子表格数据'
  if (/presentation|slide|ppt/.test(text)) return '创建、编辑和检查演示文稿或幻灯片'
  if (/document|docx|word/.test(text)) return '创建、编辑、整理和校验文档内容'
  if (/notion/.test(text)) return '连接 Notion 知识库、文档、任务和项目资料'
  if (/outlook/.test(text)) return '处理 Outlook 邮件、收件箱整理、回复草稿和共享邮箱'
  if (/canva/.test(text)) return '生成或调整 Canva 设计、演示和社交媒体素材'
  if (/figma|figjam/.test(text)) return '读取、生成或同步 Figma / FigJam 设计内容'
  if (/browser|playwright|web/.test(text)) return '控制浏览器进行页面检查、交互测试和截图验证'
  if (text.includes('github') || text.includes('pull request') || text.includes('issue')) return '处理代码仓库、Issue、PR、CI 或代码协作相关工作'
  if (text.includes('google') || text.includes('gmail') || text.includes('calendar') || text.includes('drive')) return '连接 Google 生态中的邮件、日历、云盘、联系人或文档能力'
  if (text.includes('lark') || text.includes('feishu')) return '连接飞书能力，用于消息、文档、日历、任务或企业协作流程'
  if (text.includes('protein') || text.includes('gene') || text.includes('genomic') || text.includes('biology')) return '处理生命科学数据、实验设计、基因组、蛋白或分子分析任务'
  if (text.includes('clinical') || text.includes('patient') || text.includes('trial')) return '面向临床研究、患者记录、试验报告或医学决策支持'
  if (text.includes('data') || text.includes('analysis') || text.includes('database')) return '读取、整理、分析和查询结构化或科学数据'
  if (text.includes('image') || text.includes('diagram') || text.includes('visual')) return '生成、编辑或整理可视化内容与设计素材'
  if (text.includes('mail') || text.includes('message') || text.includes('discord') || text.includes('imessage')) return '收发消息、读取会话、管理协作沟通内容'
  if (text.includes('cli') || text.includes('command')) return '封装命令行工具能力，便于 Agent 自动执行相关操作'
  if (raw.trim()) return summarizeSkillEnglishText(name, raw)
  return '暂无更详细的中文说明，点开后可查看可用工具清单'
}

function summarizeSkillEnglishText(name: string, raw: string): string {
  const lower = `${name} ${raw}`.toLowerCase()
  const topics: string[] = []
  if (/search|find|query|lookup/.test(lower)) topics.push('搜索和查询信息')
  if (/create|generate|build|new/.test(lower)) topics.push('创建或生成内容')
  if (/edit|update|modify|patch/.test(lower)) topics.push('编辑和更新已有内容')
  if (/send|message|mail|notify/.test(lower)) topics.push('发送消息或通知')
  if (/read|fetch|download|list/.test(lower)) topics.push('读取、下载或列出资料')
  if (/sync|publish|deploy|upload/.test(lower)) topics.push('同步、发布或上传资源')
  if (/control|manage|admin|permission/.test(lower)) topics.push('管理配置、权限或设备')
  if (/data|report|analytics|metric|usage/.test(lower)) topics.push('统计数据、生成报告或分析用量')
  if (/cli|command|shell|process/.test(lower)) topics.push('封装命令行或进程操作')
  if (!topics.length) topics.push('为 Agent 提供可调用的专项工具')
  return `这个技能主要用于${Array.from(new Set(topics)).join('、')}。点开详情可以查看中文说明、原文、类型、状态和可用工具。`
}

function isSkillTextEnglishHeavy(text: string): boolean {
  const raw = String(text || '')
  const english = raw.match(/[A-Za-z]{4,}/g)?.length || 0
  const chinese = raw.match(/[\u4e00-\u9fff]/g)?.length || 0
  return english >= 8 && chinese < english * 2
}

function inferSkillDocTopics(name: string, raw: string): string[] {
  const lower = `${name} ${raw}`.toLowerCase()
  const topics: string[] = []
  if (/lark|feishu/.test(lower)) topics.push('处理飞书消息、文档、日历、任务、云盘或企业协作流程')
  if (/github|pull request|issue|ci/.test(lower)) topics.push('处理代码仓库、Issue、PR、CI 和代码协作')
  if (/message|mail|discord|imessage|gmail/.test(lower)) topics.push('收发消息、整理邮件或读取会话记录')
  if (/data|analysis|dashboard|report|metric/.test(lower)) topics.push('读取数据、生成分析、报表或仪表盘')
  if (/image|diagram|visual|canvas|figma/.test(lower)) topics.push('生成或整理图片、图表、设计稿和可视化内容')
  if (/browser|web|page|playwright/.test(lower)) topics.push('控制浏览器、检查网页和自动化页面操作')
  if (/python|script|cli|command|shell/.test(lower)) topics.push('封装脚本或命令行工具，方便 Agent 自动执行')
  if (/model|token|usage|cost/.test(lower)) topics.push('统计模型、Token 和费用使用情况')
  if (/pdf|docx|xlsx|pptx|spreadsheet|document/.test(lower)) topics.push('处理文档、表格、PDF 或演示文稿')
  if (!topics.length) topics.push(getSkillDescription(name, ''))
  return Array.from(new Set(topics)).filter(Boolean)
}

const SKILL_DOC_TOOL_NAMES: Record<string, string> = {
  exec: '执行命令',
  bash: 'Shell 脚本',
  process: '进程管理',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  apply_patch: '应用补丁',
  message: '发送消息',
  cron: '定时任务',
  session_status: '会话状态',
  sessions_list: '会话列表',
  memory_search: '记忆检索',
  search: '搜索',
  install: '安装',
  update: '更新',
  sync: '同步',
  publish: '发布',
}

function extractSkillToolsFromDoc(raw: string): string[] {
  const names = new Set<string>()
  for (const line of String(raw || '').split('\n')) {
    const m = line.match(/^\s*[-*]?\s*`?([a-z][a-z0-9_-]{2,})`?\s*(?:[:：-]|—)/i)
    if (m) names.add(m[1])
  }
  return Array.from(names)
    .filter(n => ownValue(SKILL_DOC_TOOL_NAMES, n) || /^[a-z][a-z0-9_-]{2,}$/.test(n))
    .slice(0, 10)
}

function buildSkillDocChinese(name: string, raw: string, translated: string): string {
  const existing = String(translated || '').trim()
  if (existing && !isSkillTextEnglishHeavy(existing)) return existing
  const title = getSkillDisplayName(name)
  const topics = inferSkillDocTopics(name, raw)
  const tools = extractSkillToolsFromDoc(raw)
  return `# ${title}

## 这个技能是做什么的

${getSkillDescription(name)}。

## 适合什么时候用

${topics.map(t => `- ${t}`).join('\n')}

${tools.length ? `## 可见工具\n\n${tools.map(t => `- ${ownValue(SKILL_DOC_TOOL_NAMES, t) || slugToChineseName(t)}（原始工具名：\`${t}\`）`).join('\n')}\n\n` : ''}## 状态与类型

- 类型：${getSkillCategory(name)}
- 原始标识：\`${name}\`
- 状态：可在技能库卡片上查看安装、启用或禁用状态。

## 原文说明

英文原文、命令参数和完整 SKILL.md 已收起；需要逐字核对时点「显示英文原文」。`
}

// ── 技能文档弹窗（独立文档页面，markdown 渲染，阅读舒适）──
const skillDocVisible = ref(false)
const skillDocName = ref('')
const skillDocTitle = ref('')
const skillDocSubtitle = ref('')
const skillDocSourceText = ref('')
const skillDocSourceKind = ref('unknown')
const skillDocSourceTitle = ref('')
const skillDocContent = ref('')        // 英文原文 SKILL.md
const skillDocTranslated = ref('')     // 中文译文（含代码大白话讲解）
const skillDocAlreadyChinese = ref(false) // 原文本来就是中文，无需翻译
const skillDocShowOriginal = ref(false) // 默认显示中文译文
const skillDocLoading = ref(false)
const skillDocHasTranslation = computed<boolean>(() => !!skillDocTranslated.value.trim())
// 当前展示的 markdown 源：有译文且未切到原文 → 译文；否则原文
const skillDocActiveText = computed<string>(() =>
  (skillDocHasTranslation.value && !skillDocShowOriginal.value)
    ? skillDocTranslated.value
    : skillDocContent.value
)
const skillDocHtml = computed<string>(() => {
  const src = skillDocActiveText.value
  if (!src) return ''
  return renderSafeMarkdown(src, source => marked.parse(source, { async: false }) as string)
})
async function openSkillDoc(name: string): Promise<void> {
  const skill = findSkillInfo(name)
  skillDocName.value = name
  skillDocTitle.value = getSkillDisplayName(name)
  skillDocSubtitle.value = `${name} · SKILL.md 技能文档`
  skillDocSourceText.value = getSkillSourceText(skill)
  skillDocSourceKind.value = getSkillSourceKind(skill)
  skillDocSourceTitle.value = getSkillSourceTitle(skill)
  skillDocVisible.value = true
  skillDocShowOriginal.value = false
  skillDocContent.value = ''
  skillDocTranslated.value = ''
  skillDocLoading.value = true
  try {
    const resp = await fetch(`/api/system/skill-readme?name=${encodeURIComponent(name)}`)
    if (resp.ok) {
      const data = await resp.json()
      const raw = String(data.content || '')
      const translated = String(data.translated || '')
      skillDocContent.value = raw
      skillDocTranslated.value = buildSkillDocChinese(name, raw, translated)
      skillDocAlreadyChinese.value = !!data.alreadyChinese
    }
  } catch (_) { /* ignore */ }
  finally { skillDocLoading.value = false }
}

async function openSkillReference(name: string, refName: string): Promise<void> {
  const skill = findSkillInfo(name)
  skillDocName.value = `${name}/${refName}`
  skillDocTitle.value = `${getSkillDisplayName(name)} · ${getSkillReferenceLabel(refName)}`
  skillDocSubtitle.value = `${name} · references/${refName}.md 参考资料`
  skillDocSourceText.value = getSkillSourceText(skill)
  skillDocSourceKind.value = getSkillSourceKind(skill)
  skillDocSourceTitle.value = getSkillSourceTitle(skill)
  skillDocVisible.value = true
  skillDocShowOriginal.value = false
  skillDocContent.value = ''
  skillDocTranslated.value = ''
  skillDocAlreadyChinese.value = false
  skillDocLoading.value = true
  try {
    const resp = await fetch(`/api/system/skill-reference?name=${encodeURIComponent(name)}&ref=${encodeURIComponent(refName)}`)
    if (resp.ok) {
      const data = await resp.json()
      const raw = String(data.content || '')
      const translated = String(data.translated || '')
      skillDocContent.value = raw
      skillDocTranslated.value = buildSkillDocChinese(name, raw, translated)
      skillDocAlreadyChinese.value = !!data.alreadyChinese
      if (!skillDocContent.value && !skillDocTranslated.value) {
        skillDocTranslated.value = `# ${getSkillReferenceLabel(refName)}\n\n这是 ${getSkillDisplayName(name)} 随技能附带的参考资料。当前工作台能识别到该资料入口，但没有读取到对应正文。`
      }
    }
  } catch (_) {
    skillDocTranslated.value = `# ${getSkillReferenceLabel(refName)}\n\n读取参考资料失败，请稍后重试。`
  }
  finally { skillDocLoading.value = false }
}
function getExpandedSkillSummary(name: string): string {
  const detail = ownValue(skillDetailCache.value, name)
  const base = getSkillDescription(name, detail?.description)
  const content = detail?.content || ''
  const text = `${name} ${detail?.description || ''} ${content}`.toLowerCase()
  if (ownValue(SKILL_DESCRIPTIONS, name)) {
    return `${base}。适合在 Agent 工作流中直接调用，展开后可确认它暴露的具体工具。`
  }
  if (text.includes('github') || text.includes('pull request') || text.includes('issue')) return '这个技能主要围绕 GitHub 协作展开，包含仓库查询、Issue/PR 处理、CI 日志读取、评论与自动化修复等能力。'
  if (text.includes('lark') || text.includes('feishu')) return '这个技能主要封装飞书工作流，覆盖消息、文档、云盘、任务、日历、审批或知识库等企业协作场景。'
  if (text.includes('protein') || text.includes('gene') || text.includes('genomic') || text.includes('biology')) return '这个技能面向科研和生命科学任务，通常会提供数据读取、数据库查询、模型分析或实验流程辅助工具。'
  if (text.includes('mail') || text.includes('message') || text.includes('discord')) return '这个技能面向消息和邮件协作，通常支持读取、发送、搜索、整理和回复沟通内容。'
  if (text.includes('image') || text.includes('diagram') || text.includes('visual')) return '这个技能面向视觉产物，通常支持图片、图表、流程图、画布或其他设计素材生成。'
  if (text.includes('cli') || text.includes('command')) return '这个技能把命令行能力包装成 Agent 可调用工具，用于自动执行、查询或管理对应系统。'
  return `${base}。展开详情后可以看到它当前暴露给工作台的工具清单。`
}

function getSkillCategory(name: string): string {
  for (const [cat, skills] of Object.entries(SKILL_CATEGORIES)) {
    if (skills.includes(name)) return cat
  }
  return '其他'
}

function getSkillLogoSrc(name: string): string {
  const lower = name.toLowerCase()
  // 飞书系
  if (lower.includes('lark') || lower.includes('feishu')) return '/skill-logos/feishu.png'
  // 品牌精确匹配（顺序即优先级）
  if (lower.includes('github') || lower.startsWith('gh-')) return '/skill-logos/github.svg'
  if (lower.includes('google') || lower === 'gog' || lower.includes('goplaces') || lower.includes('gemini') || lower.includes('gmail')) return '/skill-logos/google.svg'
  if (lower.includes('apple') || lower.includes('imsg') || lower.includes('imessage')) return '/skill-logos/apple.svg'
  if (lower.includes('openai') || lower.includes('whisper')) return '/model-logos/openai.svg'
  if (lower.includes('python') || lower.includes('debugpy')) return '/skill-logos/python.svg'
  if (lower.includes('node-inspect') || lower.startsWith('node')) return '/skill-logos/nodejs.svg'
  if (lower === 'docx' || lower.includes('word')) return '/skill-logos/word.svg'
  if (lower === 'xlsx' || lower.includes('excel') || lower.includes('sheet')) return '/skill-logos/excel.svg'
  if (lower === 'pptx' || lower.includes('slides') || lower.includes('poster')) return '/skill-logos/ppt.svg'
  if (lower === 'pdf' || lower.includes('pdf')) return '/skill-logos/pdf.svg'
  if (lower.includes('markdown') || lower.includes('markitdown') || lower.includes('mermaid')) return '/skill-logos/markdown.svg'
  if (lower.includes('browser') || lower.includes('chrome') || lower.includes('web')) return '/skill-logos/browser.svg'
  if (lower.includes('1password')) return '/skill-logos/1password.svg'
  if (lower.includes('weather')) return '/skill-logos/weather.svg'
  if (lower.includes('health')) return '/skill-logos/health.svg'
  if (lower.includes('search') || lower.includes('lookup') || lower.includes('research')) return '/skill-logos/search.svg'
  // 只在明确识别 OpenClaw 时使用已有的 OpenClaw 客户端标识。
  if (lower === 'openclaw' || lower.startsWith('openclaw-')) return '/app-logos/openclaw-lobster.png'
  // 未证明拥有独立品牌标识的生态技能使用中性默认图标。
  if (lower.includes('clawhub') || lower.includes('taskflow') || lower.includes('skill-creator') || lower.includes('autoskill') || lower.includes('mcporter')) return '/skill-logos/default.svg'
  // 终端/开发类
  if (lower.includes('coding') || lower.includes('spike') || lower.includes('debugger') || lower.includes('terminal') || lower.includes('shell')) return '/skill-logos/terminal.svg'
  // 视觉设计类
  if (lower.includes('canvas') || lower.includes('diagram') || lower.includes('image') || lower.includes('infographic') || lower.includes('gif') || lower.includes('photo')) return '/skill-logos/design.svg'
  return '/skill-logos/default.svg'
}

function getSkillStatusLabel(skill: Pick<SkillInfo, 'installed' | 'enabled' | 'status'>): string {
  if (!skill.installed) return '未安装'
  if (skill.enabled) return '已启用'
  if (skill.status && skill.status !== 'ready') return skill.status
  return '已禁用'
}

function findSkillInfo(name: string): SkillInfo | undefined {
  return skillsData.value?.skills.find(s => s.name === name)
    || searchResults.value.find(s => s.name === name)
}

function getSkillSourceKind(skill: Partial<SkillInfo> | undefined): string {
  const raw = String(skill?.sourceKind || skill?.sourceRaw || skill?.source || '').toLowerCase()
  if (raw.includes('official') || raw.includes('bundled') || raw.includes('extra') || skill?.sourceTrust === '官方') return 'official'
  if (raw.includes('workspace')) return 'workspace'
  if (raw.includes('managed')) return 'managed'
  if (raw.includes('project')) return 'project'
  if (raw.includes('personal')) return 'personal'
  if (raw.includes('community') || raw.includes('clawhub')) return 'community'
  return 'unknown'
}

function getSkillSourceText(skill: Partial<SkillInfo> | undefined): string {
  const label = String(skill?.sourceLabel || '').trim()
  const maintainer = String(skill?.sourceMaintainer || skill?.author || '').trim()
  if (label && maintainer && !label.includes(maintainer)) return `${label} · ${maintainer}`
  if (label) return label

  const kind = getSkillSourceKind(skill)
  if (kind === 'official') return 'OpenClaw 官方'
  if (kind === 'workspace') return '本地工作区'
  if (kind === 'managed') return '本机已安装'
  if (kind === 'project') return '项目技能'
  if (kind === 'personal') return '个人技能'
  if (kind === 'community') return maintainer ? `ClawHub 社区 · ${maintainer}` : 'ClawHub 社区'
  return '未知来源'
}

function getSkillSourceTitle(skill: Partial<SkillInfo> | undefined): string {
  const raw = String(skill?.sourceRaw || skill?.source || '').trim()
  const trust = String(skill?.sourceTrust || '').trim()
  const homepage = String(skill?.homepage || '').trim()
  return [
    getSkillSourceText(skill),
    trust ? `可信度：${trust}` : '',
    raw ? `原始来源：${raw}` : '',
    homepage ? `主页：${homepage}` : '',
  ].filter(Boolean).join('\n')
}

function getCategoryIcon(catName: string) {
  return ownValue(CATEGORY_ICONS, catName) || MoreFilled
}

function shortAgentName(fullName: string): string {
  const dash = fullName.lastIndexOf('-')
  if (dash >= 0 && dash < fullName.length - 1) return fullName.slice(dash + 1)
  return fullName
}

function getAgentAvatar(id: string): string {
  return normalizeAgentAvatarSource(agentsConfigured.value.find(agent => agent.id === id)?.avatar)
}

function getAgentLabel(id: string): string {
  const agent = agentsConfigured.value.find(a => a.id === id)
  return agent ? shortAgentName(agent.name || agent.id) : id
}

// ── 计算属性 ──────────────────────────────────────────────
const installedSkills = computed(() => skillsData.value?.skills.filter(s => s.installed) ?? [])
const activatedSkills = computed(() => installedSkills.value.filter(s => s.enabled) ?? [])
const deactivatedSkills = computed(() => installedSkills.value.filter(s => !s.enabled) ?? [])
const notInstalledSkills = computed(() => skillsData.value?.skills.filter(s => !s.installed) ?? [])

const filteredSkills = computed(() => {
  switch (activeTab.value) {
    case 'activated': return activatedSkills.value
    case 'deactivated': return deactivatedSkills.value
    case 'notInstalled': return notInstalledSkills.value
    default: return skillsData.value?.skills ?? []
  }
})

/** 将当前 tab 的技能按分类分组，返回有序的对象 */
const filteredSkillsByCategory = computed(() => {
  const result: Record<string, SkillInfo[]> = createSafeRecord()
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const skill of filteredSkills.value) {
    const cat = getSkillCategory(skill.name)
    if (!Object.hasOwn(result, cat)) result[cat] = []
    result[cat].push(skill)
  }
  // 移除空分类
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

/** 按 Agent tab：已选 Agent 的技能（与 skillsData 合并，得到 installed/enabled 状态） */
const selectedAgentSkills = computed(() => {
  const agent = agentsConfigured.value.find(a => a.id === selectedAgentId.value)
  if (!agent) return []
  return agent.skills.map(skillName => {
    const info = skillsData.value?.skills.find(s => s.name === skillName)
    return {
      name: skillName,
      installed: info?.installed ?? false,
      enabled: info?.enabled ?? false,
      status: info?.status || '',
    }
  })
})

const selectedAgentSkillsByCategory = computed(() => {
  const result: Record<string, typeof selectedAgentSkills.value> = createSafeRecord()
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const skill of selectedAgentSkills.value) {
    const cat = getSkillCategory(skill.name)
    if (!Object.hasOwn(result, cat)) result[cat] = []
    result[cat].push(skill)
  }
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

// ── 对比 tab 计算属性 ─────────────────────────────────────

/** 所有 agent 技能的并集（去重） */
const allCompareSkills = computed<string[]>(() => {
  const s = new Set<string>()
  for (const ag of agentsConfigured.value) {
    for (const sk of ag.skills) s.add(sk)
  }
  return [...s]
})

/** 按分类分组的对比技能 */
const compareSkillsByCategory = computed<Record<string, string[]>>(() => {
  const result: Record<string, string[]> = createSafeRecord()
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const sk of allCompareSkills.value) {
    const cat = getSkillCategory(sk)
    if (!Object.hasOwn(result, cat)) result[cat] = []
    result[cat].push(sk)
  }
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

/** 对比状态：某技能在某 agent 上的状态 */
function compareStatus(skillName: string, agentId: string): 'enabled' | 'inactive' | 'absent' {
  const ag = agentsConfigured.value.find(a => a.id === agentId)
  if (!ag) return 'absent'
  // skills 数组已经在 fetchAgents 处理过 unconstrained，直接判断是否包含
  if (!ag.skills.includes(skillName)) return 'absent'
  const info = skillsData.value?.skills.find(s => s.name === skillName)
  if (!info?.installed) return 'inactive'
  return info.enabled ? 'enabled' : 'inactive'
}

function compareDotTitle(skillName: string, agentId: string): string {
  const ag = agentsConfigured.value.find(a => a.id === agentId)
  const agName = ag ? shortAgentName(ag.name || ag.id) : agentId
  const st = compareStatus(skillName, agentId)
  if (st === 'enabled') return `${agName} · 已激活`
  if (st === 'inactive') {
    const ag2 = agentsConfigured.value.find(a => a.id === agentId)
    const configured = ag2?.skills.includes(skillName)
    if (configured) {
      const info = skillsData.value?.skills.find(s => s.name === skillName)
      if (!info?.installed) return `${agName} · 已配置但未安装`
      return `${agName} · 已安装未激活`
    }
    return `${agName} · 未配置`
  }
  return `${agName} · 未配置`
}

// ── watch ─────────────────────────────────────────────────
watch(() => props.visible, async (val) => {
  if (val) {
    await nextTick()
    fetchSkills()
    fetchAgents()
  }
})

// ── Sprint 8 #8: 技能使用统计 ──────────────────────────────
const usageLoading = ref(false)
const usageDays = ref(30)
const usageRanked = ref<{ name: string; total: number; byAgent: Record<string, number> }[]>([])
const usageUpdatedAt = ref('')
const usageTotalCalls = computed(() => usageRanked.value.reduce((s, r) => s + r.total, 0))

const USAGE_BAR_COLORS = ['#5e5ce6','#ff9f0a','#30d158','#0a84ff','#bf5af2','#ff375f','#0a84ff','#ff9f0a','#84cc16','#06b6d4']
function usageBarColor(idx: number) { return USAGE_BAR_COLORS[idx % USAGE_BAR_COLORS.length] }

// 技能参考文档（references/*.md）→ 中文说明
const SKILL_TOOL_REF_ZH: Record<string, string> = {
  'block-types': '飞书文档块类型对照表',
}

function getSkillReferenceLabel(name: string): string {
  const referenceName = ownValue(SKILL_TOOL_REF_ZH, name)
  if (referenceName) return referenceName
  const normalized = name.replace(/[-_]+/g, ' ').trim().toLowerCase()
  if (normalized.includes('api')) return 'API 参考资料'
  if (normalized.includes('tool')) return '工具参考资料'
  if (normalized.includes('schema')) return '数据结构参考资料'
  if (normalized.includes('template')) return '模板参考资料'
  if (normalized.includes('example')) return '示例参考资料'
  if (normalized.includes('guide')) return '使用指南'
  if (normalized.includes('prompt')) return '提示词参考'
  return '参考资料'
}

// 核心工具名 → 中文说明
const TOOL_NAME_ZH: Record<string, string> = {
  exec: '执行命令',
  bash: 'Shell 脚本',
  process: '进程管理',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  message: '发送消息',
  memory_search: '记忆检索',
  memory_get: '读取记忆',
  session_status: '会话状态',
  cron: '定时任务',
  apply_patch: '应用补丁',
  update_plan: '更新计划',
  sessions_list: '会话列表',
  sessions_send: '发送至会话',
  web_fetch: '网页抓取',
}

type UsageItem = { name: string; total: number; byAgent: Record<string, number> }
const usageToolVisible = ref(false)
const usageToolItem = ref<UsageItem | null>(null)
const usageToolShowOriginal = ref(false)

function getUsageDisplayName(name: string): string {
  return ownValue(TOOL_NAME_ZH, name) || getSkillDisplayName(name)
}

function getUsageCategory(name: string): string {
  if (ownValue(TOOL_NAME_ZH, name)) return '内置工具'
  return getSkillCategory(name)
}

function openUsageToolDetail(item: UsageItem): void {
  usageToolItem.value = item
  usageToolShowOriginal.value = false
  usageToolVisible.value = true
}

const usageToolTitle = computed(() => usageToolItem.value ? getUsageDisplayName(usageToolItem.value.name) : '工具详情')
const usageToolCategory = computed(() => usageToolItem.value ? getUsageCategory(usageToolItem.value.name) : '工具')
const usageToolStatus = computed(() => {
  const name = usageToolItem.value?.name
  if (!name) return '未选择'
  const skill = skillsData.value?.skills.find(s => s.name === name)
  if (skill) return getSkillStatusLabel(skill)
  return ownValue(TOOL_NAME_ZH, name) ? '系统内置' : '统计来源'
})
const usageToolHasSkillDoc = computed(() => {
  const name = usageToolItem.value?.name
  if (!name) return false
  return !!skillsData.value?.skills.some(s => s.name === name)
})
const usageToolDescription = computed(() => {
  const name = usageToolItem.value?.name || ''
  if (!name) return ''
  const toolName = ownValue(TOOL_NAME_ZH, name)
  if (toolName) {
    return `${toolName}是 Agent 运行过程中使用的内置工具能力。这里展示的是近 ${usageDays.value} 天内它被调用的次数，以及哪些 Agent 使用过它。`
  }
  return getSkillDescription(name)
})
const usageToolAgents = computed(() => {
  const item = usageToolItem.value
  if (!item) return []
  return Object.entries(item.byAgent || {})
    .map(([id, count]) => ({ id, count, name: getAgentLabel(id) }))
    .sort((a, b) => b.count - a.count)
})

// 未使用明细：已安装未启用 + 未安装的技能，按分类分组
const unusedSkillsExpanded = ref(false)
const unusedSkillsList = computed(() => {
  return (skillsData.value?.skills ?? [])
    .filter(s => !s.enabled)
    .map(s => ({
      ...s,
      name: s.name,
      displayName: getSkillDisplayName(s.name),
      category: getSkillCategory(s.name),
      statusLabel: s.installed ? '已禁用' : '未安装',
      description: getSkillDescription(s.name, s.description),
    }))
})
const unusedSkillsByCategory = computed(() => {
  const result: Record<string, typeof unusedSkillsList.value> = createSafeRecord()
  const catOrder = Object.keys(SKILL_CATEGORIES).concat(['其他'])
  for (const cat of catOrder) result[cat] = []
  for (const skill of unusedSkillsList.value) {
    if (!Object.hasOwn(result, skill.category)) result[skill.category] = []
    result[skill.category].push(skill)
  }
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

async function fetchUsage() {
  usageLoading.value = true
  try {
    const resp = await fetch(`/api/skill-usage?days=${usageDays.value}&limit=30`)
    if (resp.ok) {
      const data = await resp.json()
      usageRanked.value = data.ranked || []
      usageUpdatedAt.value = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('zh-CN') : ''
    }
  } catch { /* ignore */ } finally {
    usageLoading.value = false
  }
}

function setUsageDays(days: number) {
  usageDays.value = days
  fetchUsage()
}

// 切换到使用统计 tab 时自动拉取
watch(activeTab, (tab) => { if (tab === 'usage') fetchUsage() })

// ── API 调用 ──────────────────────────────────────────────
async function fetchSkills(): Promise<void> {
  loading.value = true
  try {
    const data = await getSkills()
    if (data) {
      skillsData.value = data
    } else {
      ElMessage.error('获取技能列表失败')
    }
  } catch {
    console.error('[SkillsDialog] skills request failed')
    ElMessage.error('获取技能列表异常')
  } finally {
    loading.value = false
  }
}

async function fetchAgents(): Promise<void> {
  try {
    const resp = await fetch('/api/agents-configured')
    if (resp.ok) {
      const data = await resp.json()
      // 处理 skillsUnconstrained：没有限制的 agent 使用所有已安装技能
      const allInstalled = (skillsData.value?.skills || []).filter(s => s.installed).map(s => s.name)
      agentsConfigured.value = (data.agents || []).map((a: AgentConfigured) => ({
        ...a,
        skills: a.skillsUnconstrained ? allInstalled : (a.skills || []),
      })).filter((a: AgentConfigured) => a.skills.length > 0)
      if (agentsConfigured.value.length > 0 && !selectedAgentId.value) {
        selectedAgentId.value = agentsConfigured.value[0].id
      }
    }
  } catch {
    console.error('[SkillsDialog] Agent request failed')
  }
}

function handleSearch(): void {
  searchSkills(searchQuery.value)
}

async function searchSkills(query: string): Promise<void> {
  if (!query.trim()) return
  searching.value = true
  hasSearched.value = true
  try {
    const result = await searchClawHubSkills(query.trim())
    if (result?.success) {
      searchResults.value = result.skills ?? []
    } else {
      searchResults.value = []
      ElMessage.warning('未找到相关技能')
    }
  } catch {
    console.error('[SkillsDialog] skill search failed')
    searchResults.value = []
    ElMessage.error('搜索失败')
  } finally {
    searching.value = false
  }
}

async function handleInstall(skill: SkillInfo | string): Promise<void> {
  const skillName = typeof skill === 'string' ? skill : skill.name
  const source = typeof skill === 'string' ? undefined : skill.source
  const wasClawHubTab = activeTab.value === 'clawhub'
  installingSkills.value.set(skillName, true)
  try {
    const result = await installSkill(skillName, source)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 安装成功`)
      installingSkills.value.delete(skillName)
      await fetchSkills()
      if (wasClawHubTab && hasSearched.value && searchQuery.value.trim()) {
        await searchSkills(searchQuery.value.trim())
      }
    } else {
      ElMessage.error(result?.message ?? `安装 "${skillName}" 失败`)
    }
  } catch {
    console.error('[SkillsDialog] skill installation failed')
    ElMessage.error(`安装 "${skillName}" 异常`)
  } finally {
    installingSkills.value.delete(skillName)
  }
}

async function handleToggle(skillName: string, enabled: boolean): Promise<void> {
  togglingSkills.value.set(skillName, true)
  try {
    const result = await toggleSkill(skillName, enabled)
    if (result?.success) {
      ElMessage.success(`"${skillName}" 已${enabled ? '启用' : '禁用'}`)
      togglingSkills.value.delete(skillName)
      await fetchSkills()
    } else {
      ElMessage.error(result?.message ?? `切换 "${skillName}" 状态失败`)
    }
  } catch {
    console.error('[SkillsDialog] skill toggle failed')
    ElMessage.error(`切换 "${skillName}" 状态异常`)
  } finally {
    togglingSkills.value.delete(skillName)
  }
}

function getStatusType(status: string): '' | 'success' | 'warning' | 'danger' | 'info' {
  const s = status.toLowerCase()
  if (s.includes('ready') || s.includes('active') || s.includes('enabled')) return 'success'
  if (s.includes('disabled') || s.includes('inactive')) return 'info'
  if (s.includes('error') || s.includes('fail')) return 'danger'
  return 'warning'
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays < 30) return `${diffDays}天前`
    return date.toLocaleDateString('zh-CN')
  } catch {
    return dateStr
  }
}
</script>

<style scoped>
/* ── 统计栏 ── */
.skills-stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-bottom: 16px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-elevated);
  font-size: 14px;
}

.stats-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.stats-label { color: var(--text-secondary); font-size: 13px; }
.stats-value { color: var(--text-primary); font-weight: 700; font-size: 18px; font-variant-numeric: tabular-nums; }
.stats-ready { color: #30d158; }
.stats-divider { width: 1px; height: 24px; background: var(--border-color); }
.refresh-skills-btn { margin-left: auto; flex-shrink: 0; }

/* ── Tab ── */
.skills-tabs { margin-bottom: 16px; }
.skills-tabs :deep(.el-tabs__header) { margin-bottom: 0; }
.skills-tabs :deep(.el-tabs__nav-wrap)::after { background-color: var(--border-color); }
.skills-tabs :deep(.el-tabs__item) { color: var(--text-secondary); font-size: 14px; font-weight: 500; }
.skills-tabs :deep(.el-tabs__item.is-active) { color: var(--accent, #0a84ff); }
.skills-tabs :deep(.el-tabs__active-bar) { background-color: var(--accent, #0a84ff); }
.tab-label-icon { display: inline-flex; align-items: center; gap: 4px; }

.tab-count {
  margin-left: 4px;
  font-size: 11px;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
}

/* ── 加载 ── */
.skills-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ── 滚动区域 ── */
.skills-scrollbar { height: 65vh; }

/* ── 分类标题 ── */
.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 6px;
  margin-top: 8px;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
  transition: background 0.15s;
}
.category-header:hover { background: var(--fill-subtle); }
.category-header:first-child { margin-top: 0; }
.category-icon { font-size: 15px; color: var(--text-secondary); }
.category-name { font-size: 13px; font-weight: 700; color: var(--text-primary); flex: 1; }
.category-count {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--fill-subtle);
  border-radius: 10px;
  padding: 0 7px;
  height: 18px;
  line-height: 18px;
}
.category-chevron {
  font-size: 13px;
  color: var(--text-secondary);
  transition: transform 0.2s;
  display: inline-block;
  margin-left: 2px;
}
.category-chevron.collapsed { transform: rotate(-90deg); }

/* ── 卡片网格 ── */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  padding: 0 4px 12px;
}

/* ── 技能卡片 ── */
.skill-card {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  transition: all 0.2s;
}
.skill-card:hover {
  border-color: var(--accent);
  box-shadow: 0 3px 12px var(--accent-glow);
  transform: translateY(-1px);
}

.skill-card--expanded {
  border-color: rgba(10, 132, 255, 0.5);
  box-shadow: 0 8px 24px rgba(10, 132, 255, 0.12);
}

.skill-card :deep(.el-card__body) {
  padding: 12px 14px;
  position: relative;
}

.skill-status-badges {
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 1;
}

.status-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.badge-enabled { color: #30d158; background: rgba(48, 209, 88,0.1); }

.install-skill-btn, .toggle-skill-btn {
  font-size: 11px;
  padding: 4px 10px;
  height: auto;
  line-height: 1;
}
.install-skill-btn :deep(.el-icon) { font-size: 11px; }
.install-btn-group { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }

.skill-card-inner { display: flex; gap: 12px; align-items: flex-start; }
.skill-icon-wrap {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(135deg, rgba(94, 92, 230,0.16), rgba(10, 132, 255,0.10));
  border: 1px solid var(--border-color);
  color: #9d9bff;
}
.skill-logo-img {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
}
.skill-icon-wrap .skill-logo-img {
  width: 26px;
  height: 26px;
}
.skill-row-logo {
  width: 28px;
  height: 28px;
}
.skill-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 2px 0 5px;
  font-size: 10px;
  color: var(--text-secondary);
}
.skill-meta-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-source-badge {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid rgba(142, 142, 147, 0.22);
  background: rgba(142, 142, 147, 0.10);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 1.45;
}
.skill-source-badge--official {
  border-color: rgba(48, 209, 88, 0.28);
  background: rgba(48, 209, 88, 0.10);
  color: #67d783;
}
.skill-source-badge--community {
  border-color: rgba(10, 132, 255, 0.28);
  background: rgba(10, 132, 255, 0.10);
  color: #6cb2ff;
}
.skill-source-badge--workspace,
.skill-source-badge--managed {
  border-color: rgba(255, 159, 10, 0.28);
  background: rgba(255, 159, 10, 0.10);
  color: #ffb366;
}
.skill-source-badge--project,
.skill-source-badge--personal {
  border-color: rgba(191, 90, 242, 0.26);
  background: rgba(191, 90, 242, 0.10);
  color: #d5a6ff;
}
.skill-icon-default {
  background: linear-gradient(135deg, rgba(94, 92, 230,0.16), rgba(10, 132, 255,0.10));
  color: #9d9bff;
}
.skill-info { flex: 1; min-width: 0; }
.skill-name-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.skill-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.skill-id-row { font-size: 10px; color: var(--text-secondary); opacity: 0.78; margin-bottom: 3px; }
.skill-status-tag { flex-shrink: 0; }
.skill-description {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-card-detail {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px dashed rgba(152, 152, 157, 0.18);
}

.skill-detail-summary {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

/* ── SKILL.md 源码查看 ── */
.skill-source-block {
  margin-top: 8px;
}
.skill-source-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--el-color-primary, #0a84ff);
  background: transparent;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  transition: all .15s;
}
.skill-source-toggle:hover {
  background: var(--el-color-primary-light-9, #ecf5ff);
  border-color: var(--el-color-primary, #0a84ff);
}
/* ── 技能文档弹窗 ── */
.skill-doc-head { display: flex; align-items: center; gap: 12px; padding-right: 36px; }
.skill-doc-head-icon { font-size: 24px; line-height: 1; color: var(--el-color-primary, #0a84ff); }
.skill-doc-head-text { flex: 1; min-width: 0; }
.skill-doc-head-title { font-size: 17px; font-weight: 600; color: var(--text-primary, #1d1d1f); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.skill-doc-head-sub { font-size: 12px; color: var(--text-secondary, #909399); margin-top: 3px; }
.skill-doc-source {
  width: fit-content;
  margin-top: 6px;
}
.skill-doc-badge { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 10px; }
.skill-doc-badge.zh { background: rgba(48, 209, 88,0.15); color: #30d158; }
.skill-doc-badge.en { background: rgba(94, 92, 230,0.15); color: #5e5ce6; }
.skill-doc-badge.none { background: rgba(255, 159, 10,0.15); color: #ff9f0a; }
.skill-doc-toggle-btn {
  display: inline-flex; align-items: center; gap: 4px;
  flex-shrink: 0; cursor: pointer; font-size: 12px; font-family: inherit;
  padding: 5px 12px; border-radius: 6px; border: 1px solid var(--el-border-color, #dcdfe6);
  background: var(--el-fill-color-light, #f5f7fa); color: var(--text-primary, #1d1d1f);
  transition: all 0.15s;
}
.skill-doc-toggle-btn:hover { border-color: #5e5ce6; color: #5e5ce6; }
.skill-doc-loading,
.skill-doc-empty { padding: 48px 0; text-align: center; color: var(--text-secondary, #909399); font-size: 14px; }
.skill-doc-body { padding: 4px 24px 24px; }

/* ── 按 Agent tab ── */
.by-agent-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.agent-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
}

.agent-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  background: var(--bg-elevated);
  transition: all 0.2s;
  user-select: none;
}
.agent-chip:hover {
  border-color: var(--accent, #0a84ff);
  background: rgba(10, 132, 255,0.08);
}
.agent-chip--active {
  border-color: var(--accent, #0a84ff);
  background: rgba(10, 132, 255,0.15);
}
.agent-chip-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-color);
}
.agent-chip-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.agent-chip-count {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--fill-subtle);
  border-radius: 8px;
  padding: 1px 6px;
}

.agent-no-skills { padding: 30px 0; }

/* 按 Agent tab 技能列表（列表式，更紧凑） */
.skills-list-compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px 14px;
}

.skill-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: background 0.15s;
}
.skill-row:hover {
  background: var(--fill-subtle);
  border-color: var(--border-color);
}
.skill-row--enabled  { /* full opacity */ }
.skill-row--inactive  { opacity: 0.75; }
.skill-row--uninstalled { opacity: 0.4; }

.skill-row-status { padding-top: 5px; flex-shrink: 0; }
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.2s;
}
/* 已激活：绿色实心 */
.status-dot--on {
  background: #30d158;
  box-shadow: 0 0 5px rgba(48, 209, 88,0.7);
}
/* 已安装但未激活：橙色实心 */
.status-dot--inactive {
  background: #ff9f0a;
  box-shadow: 0 0 4px rgba(255, 159, 10,0.5);
}
/* 未安装：灰色虚线圆圈 */
.status-dot--off {
  background: transparent;
  border: 1.5px dashed rgba(255,255,255,0.3);
}

.skill-row-info { flex: 1; min-width: 0; }
.skill-row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.skill-row-id { font-size: 11px; color: var(--text-secondary); opacity: 0.65; font-family: monospace; font-weight: 400; }
.skill-row-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; line-height: 1.4; }
.skill-row--expanded { background: rgba(10, 132, 255,0.06); border-radius: 6px; }
.skill-row { cursor: pointer; }

.skill-row-expand {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-color);
}
.skill-row-expand-loading { font-size: 11px; color: var(--text-secondary); }
.skill-tools-label {
  font-size: 10px; color: var(--text-secondary);
  font-weight: 600; letter-spacing: 0.05em;
  text-transform: uppercase; display: block; margin-bottom: 5px;
}
.skill-tools-list {
  display: flex; flex-wrap: wrap; gap: 4px;
}

.skill-tools-list--card {
  margin-top: 6px;
}
.skill-tool-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  background: rgba(10, 132, 255,0.1);
  color: #8ecbff;
  border: 1px solid rgba(64, 156, 255,0.25);
  border-radius: 999px;
  padding: 4px 8px;
  font-family: inherit;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .15s;
}
.skill-tool-tag:hover {
  background: rgba(10, 132, 255,0.16);
  border-color: rgba(64, 156, 255,0.42);
  transform: translateY(-1px);
}
.skill-tool-tag-zh {
  font-size: 10px;
  color: var(--text-secondary);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}

.skill-tools-section {
  margin-top: 8px;
}
.skill-tools-caption {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}

.skill-row-btn {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 8px;
  height: auto;
  line-height: 1.4;
  align-self: center;
}
.skill-uninstalled-label {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
  align-self: center;
  white-space: nowrap;
}

/* ── 弹框样式 ── */
:deep(.skills-dialog.el-dialog) {
  background-color: var(--bg-card) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
}
:deep(.skills-dialog .el-dialog__header) {
  background-color: var(--bg-card) !important;
  border-bottom: 1px solid var(--border-color) !important;
  padding: 16px 20px !important;
  margin-right: 0 !important;
}
:deep(.skills-dialog .el-dialog__title) { color: var(--text-primary) !important; }
:deep(.skills-dialog .el-dialog__body) {
  background-color: var(--bg-card) !important;
  padding: 20px !important;
  color: var(--text-primary) !important;
  max-height: 90vh !important;
  overflow-y: auto !important;
}
:deep(.skills-dialog .el-dialog__close) { color: var(--text-primary) !important; }
:deep(.skills-dialog .el-dialog__close):hover { color: var(--accent, #0a84ff) !important; }

/* ── ClawHub ── */
.clawhub-search-section { display: flex; flex-direction: column; gap: 16px; }
.clawhub-search-input { width: 100%; }
.clawhub-search-input :deep(.el-input__wrapper) { border-radius: 8px; }
.clawhub-results { display: flex; flex-direction: column; gap: 8px; }
.clawhub-scrollbar { height: 60vh; }
.clawhub-results-scroll { padding: 4px; }
.clawhub-loading { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 32px 0; color: var(--text-secondary); font-size: 14px; }
.clawhub-empty { padding: 16px 0; }
.clawhub-hint { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--text-secondary); }
.clawhub-hint-icon { color: var(--border-color); margin-bottom: 12px; }
.clawhub-hint-text { font-size: 14px; color: var(--text-secondary); margin: 0; }

/* ── 统计信息 ── */
.skill-stats { display: flex; align-items: center; gap: 12px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color); }
.stat-item { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-secondary); white-space: nowrap; }

/* ── 对比 tab ── */
.compare-section { display: flex; flex-direction: column; }
.compare-empty { padding: 32px 0; }
.compare-scrollbar { height: 65vh; }
.compare-header {
  display: flex; align-items: center;
  padding: 6px 0 6px 0;
  border-bottom: 2px solid var(--border-color);
  position: sticky; top: 0;
  background: var(--bg-card, #1a1d25);
  z-index: 2;
}
.compare-cat-row {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 0 4px 2px;
  font-size: 12px; font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.compare-cat-icon { font-size: 13px; color: var(--text-secondary); }
.compare-row {
  display: flex; align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--border-color);
}
.compare-row:hover { background: var(--fill-subtle); }
.compare-skill-col {
  flex: 0 0 220px; min-width: 220px;
  display: flex; flex-direction: column; gap: 1px;
  padding-right: 8px;
}
.compare-skill-name {
  font-size: 13px; color: var(--text-primary); font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.compare-skill-id {
  font-size: 10px; color: var(--text-secondary); opacity: 0.6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.compare-header .compare-skill-col {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.compare-agent-col {
  flex: 1; min-width: 52px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.compare-dot {
  display: inline-block;
  width: 12px; height: 12px; border-radius: 50%;
  flex-shrink: 0;
}
.compare-dot--enabled { background: #30d158; box-shadow: 0 0 6px rgba(48, 209, 88,0.5); }
.compare-dot--inactive { background: #ff9f0a; opacity: 0.85; }
.compare-dot--absent { background: transparent; border: 1.5px dashed var(--border-color); }
.compare-legend {
  display: flex; gap: 20px; align-items: center;
  padding: 14px 4px 6px 4px;
  border-top: 1px solid var(--border-color);
  margin-top: 8px;
}
.compare-legend-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-secondary);
}

/* ── 顶部固定图例（对比 tab 用） ── */
.compare-legend--top {
  display: flex;
  gap: 18px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 10px;
  background: linear-gradient(135deg, rgba(10, 132, 255,0.06), rgba(48, 209, 88,0.04));
  border: 1px solid var(--border-color);
  border-radius: 8px;
  border-top: 1px solid var(--border-color);  /* 覆盖通用 .compare-legend 的 border-top */
}
.compare-legend--top .compare-legend-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}
.compare-legend--top .compare-legend-item {
  font-size: 12px;
  color: var(--text-primary);
  gap: 7px;
}
.compare-legend--top .compare-legend-text {
  white-space: nowrap;
}

/* ── Sprint 8 #8: 使用统计 ── */
.usage-section { padding: 4px 0; }
.usage-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.usage-title { font-size: 13px; color: var(--text-secondary); }
.usage-range-btns { display: flex; gap: 4px; }
.usage-range-btn {
  background: var(--fill-subtle); border: 1px solid var(--border-color);
  border-radius: 5px; color: var(--text-muted); font-size: 11px;
  padding: 2px 8px; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.usage-range-btn:hover { background: var(--fill-hover); color: #fff; }
.usage-range-btn.active { background: rgba(94, 92, 230,0.2); border-color: rgba(94, 92, 230,0.5); color: #9d9bff; }
.usage-loading { display: flex; align-items: center; gap: 8px; padding: 40px 0; color: var(--text-secondary); justify-content: center; }
.usage-empty { padding: 40px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
.usage-list { display: flex; flex-direction: column; gap: 6px; }
.usage-row {
  display: grid;
  grid-template-columns: 32px 28px minmax(150px, 190px) 1fr 78px 94px;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.12s;
  cursor: pointer;
}
.usage-row:hover { background: var(--fill-subtle); }
.usage-rank { font-size: 11px; color: var(--text-muted); text-align: right; font-variant-numeric: tabular-nums; }
.usage-logo {
  width: 24px;
  height: 24px;
}
.usage-name-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.usage-name { font-size: 13px; color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage-name-zh { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage-bar-wrap { background: var(--fill-subtle); border-radius: 3px; height: 6px; overflow: hidden; }
.usage-bar { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
.usage-count { font-size: 12px; color: var(--text-secondary); text-align: right; font-variant-numeric: tabular-nums; }
.usage-agents { display: flex; gap: 3px; flex-wrap: wrap; }
.usage-agent-dot {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%; font-size: 11px; cursor: pointer;
  border: 1px solid var(--border-color);
  object-fit: cover;
}
.usage-footer-note { font-size: 11px; color: var(--text-muted); margin-top: 10px; text-align: center; }

/* ── 未使用明细（折叠区） ── */
.usage-unused-section {
  margin-top: 18px;
  border-top: 1px solid var(--border-color);
  padding-top: 10px;
}
.usage-unused-header {
  display: flex; align-items: center; gap: 8px;
  cursor: pointer; user-select: none; padding: 4px 6px;
  border-radius: 6px; transition: background 0.12s;
}
.usage-unused-header:hover { background: var(--fill-subtle); }
.usage-unused-chevron {
  font-size: 12px; color: var(--text-secondary);
  transition: transform 0.15s; display: inline-block;
}
.usage-unused-chevron.collapsed { transform: rotate(-90deg); }
.usage-unused-title { font-size: 13px; color: var(--text-primary); font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
.usage-unused-hint { font-size: 11px; color: var(--text-secondary); }
.usage-unused-body { padding: 10px 6px 4px 22px; display: flex; flex-direction: column; gap: 10px; }
.usage-unused-cat-name { font-size: 12px; color: var(--text-secondary); margin-bottom: 5px; display: flex; align-items: center; gap: 5px; }
.usage-unused-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
}
.usage-unused-card {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 159, 10,0.25);
  background: rgba(255, 159, 10,0.07);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: transform .15s, border-color .15s, background .15s;
}
.usage-unused-card:hover {
  transform: translateY(-1px);
  border-color: rgba(10, 132, 255,0.45);
  background: rgba(10, 132, 255,0.08);
}
.usage-unused-card--off {
  border-color: var(--border-color);
  background: var(--fill-subtle);
}
.usage-unused-logo {
  width: 26px;
  height: 26px;
}
.usage-unused-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.usage-unused-main strong {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-unused-main small {
  font-size: 10px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-unused-source {
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-unused-card em {
  font-style: normal;
  font-size: 11px;
  color: #ffb340;
}
.usage-unused-card--off em {
  color: var(--text-secondary);
}

/* ── 使用统计详情 ── */
.usage-detail-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 36px;
}
.usage-detail-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
}
.usage-detail-title-wrap {
  flex: 1;
  min-width: 0;
}
.usage-detail-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary, #f5f5f7);
}
.usage-detail-sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-secondary, #a1a1aa);
}
.usage-detail-body {
  padding: 4px 4px 2px;
}
.usage-detail-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.usage-detail-metrics > div {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--fill-subtle);
}
.usage-detail-metrics span {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.usage-detail-metrics strong {
  font-size: 18px;
  color: var(--text-primary);
}
.usage-detail-section {
  padding: 12px 0;
  border-top: 1px solid var(--border-color);
}
.usage-detail-section h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.usage-detail-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}
.usage-detail-raw {
  display: grid;
  gap: 8px;
}
.usage-detail-raw > div {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.usage-detail-raw span {
  font-size: 12px;
  color: var(--text-secondary);
}
.usage-detail-raw code {
  font-size: 12px;
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--fill-subtle);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}
.usage-detail-agents {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}
.usage-detail-agent {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: var(--fill-subtle);
}
.usage-detail-agent img {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}
.usage-detail-agent div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.usage-detail-agent strong {
  font-size: 12px;
  color: var(--text-primary);
}
.usage-detail-agent span {
  font-size: 11px;
  color: var(--text-secondary);
}
.usage-detail-actions {
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}
</style>

<!-- 非 scoped：v-html 渲染的 markdown 内容需要全局选择器才能命中 -->
<style>
.skill-doc-dialog .el-dialog__body { padding: 0; }
.skill-doc-body {
  font-size: 14px;
  line-height: 1.78;
  color: var(--el-text-color-primary, #1d1d1f);
  word-break: break-word;
}
.skill-doc-body > :first-child { margin-top: 0; }
.skill-doc-body h1,
.skill-doc-body h2,
.skill-doc-body h3,
.skill-doc-body h4,
.skill-doc-body h5,
.skill-doc-body h6 {
  margin: 22px 0 10px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--el-text-color-primary, #1f2329);
}
.skill-doc-body h1 { font-size: 22px; padding-bottom: 8px; border-bottom: 1px solid var(--el-border-color-lighter, #e5e5ea); }
.skill-doc-body h2 { font-size: 18px; padding-bottom: 6px; border-bottom: 1px solid var(--el-border-color-lighter, #e5e5ea); }
.skill-doc-body h3 { font-size: 16px; }
.skill-doc-body h4 { font-size: 14px; }
.skill-doc-body p { margin: 0 0 12px; }
.skill-doc-body ul,
.skill-doc-body ol { margin: 0 0 12px; padding-left: 1.6em; }
.skill-doc-body li { margin: 5px 0; }
.skill-doc-body li > ul,
.skill-doc-body li > ol { margin: 5px 0; }
.skill-doc-body a { color: var(--el-color-primary, #0a84ff); text-decoration: none; }
.skill-doc-body a:hover { text-decoration: underline; }
.skill-doc-body strong { font-weight: 600; }
.skill-doc-body code {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12.5px;
  background: var(--el-fill-color, #f0f2f5);
  border-radius: 4px;
  padding: 2px 6px;
  color: var(--el-color-danger, #d6336c);
}
.skill-doc-body pre {
  margin: 0 0 14px;
  padding: 14px 16px;
  background: var(--el-fill-color-light, #f6f8fa);
  border: 1px solid var(--el-border-color-lighter, #e5e5ea);
  border-radius: 8px;
  overflow-x: auto;
  line-height: 1.6;
}
.skill-doc-body pre code { background: none; padding: 0; color: var(--el-text-color-primary, #1d1d1f); font-size: 12.5px; }
.skill-doc-body blockquote {
  margin: 0 0 14px;
  padding: 4px 14px;
  border-left: 3px solid var(--el-color-primary-light-5, #a0cfff);
  color: var(--el-text-color-secondary, #909399);
  background: var(--el-fill-color-lighter, #fafafa);
  border-radius: 0 6px 6px 0;
}
.skill-doc-body table { border-collapse: collapse; width: 100%; margin: 0 0 14px; font-size: 13px; }
.skill-doc-body th,
.skill-doc-body td { border: 1px solid var(--el-border-color, #dcdfe6); padding: 7px 12px; text-align: left; }
.skill-doc-body th { background: var(--el-fill-color-light, #f5f7fa); font-weight: 600; }
.skill-doc-body hr { border: none; border-top: 1px solid var(--el-border-color-lighter, #e5e5ea); margin: 20px 0; }
.skill-doc-body img { max-width: 100%; border-radius: 6px; }
</style>
