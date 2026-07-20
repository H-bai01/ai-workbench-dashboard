 <template>
  <el-drawer v-model="drawerVisible" :title="`Agent 详情：${displayAgentName}`" :size="drawerSize" direction="rtl"
    :close-on-click-modal="true" :z-index="3000" @closed="emit('closed')">
    <template #header>
      <div class="drawer-title">
        <div class="drawer-avatar" :class="statusColorClass">
          <img
            v-if="drawerAvatarSrc"
            :src="drawerAvatarSrc"
            :alt="displayAgentName"
            class="drawer-avatar-img"
            @error="onDrawerAvatarError"
          />
          <el-icon v-else :size="18"><component :is="drawerAvatarIcon" /></el-icon>
        </div>
        <span class="title-text">{{ displayAgentName }}</span>
        <el-tag :type="statusTagType" :effect="agent?.status === 'running' ? 'dark' : 'light'" size="small"
          class="status-badge">
          <el-icon>
            <component :is="statusIcon" />
          </el-icon>
          {{ displayStatus }}
        </el-tag>
        <el-button v-if="agent" size="small" type="primary" plain @click="emit('view-execution', agent)">执行记录</el-button>
      </div>
    </template>

    <template v-if="agent">
      <div class="drawer-body">
        <!-- ========= 左侧：消息区域 ========= -->
        <div class="drawer-left">
          <div class="left-scroll-wrap">
            <el-card class="detail-section msg-section" shadow="never">
              <template #header>
                <div class="section-header">
                  <div class="section-header-left">
                    <el-icon><ChatDotRound /></el-icon>
                    消息<span v-if="filteredMessages.length > 0" class="msg-count-inline">（{{ filteredMessages.length }} 条）</span>
                  </div>
                  <div class="message-filters">
                    <el-tooltip content="打开后会显示 Agent 的内部思考片段，便于排查它为什么这样回复；平时可以关闭，聊天会更清爽。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                      <el-checkbox v-model="showThinking" size="small">显示思考信息</el-checkbox>
                    </el-tooltip>
                    <el-tooltip content="打开后会显示 Agent 调用了哪些工具、工具参数和返回结果；用于排查任务执行过程。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                      <el-checkbox v-model="showTool" size="small">显示工具信息</el-checkbox>
                    </el-tooltip>
                    <!-- 技能库快捷入口 -->
                    <el-tooltip content="查看这个 Agent 当前可用、已安装或未安装的技能；技能决定它能调用哪些能力。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                      <button
                        :class="['skills-shortcut-btn', showSkillsPanel ? 'skills-shortcut-btn--active' : '']"
                        @click="showSkillsPanel = !showSkillsPanel; showCronPanel = false"
                      >
                        <el-icon class="shortcut-icon"><Collection /></el-icon>
                        <span class="shortcut-bottom">
                          <span class="shortcut-label">技能库</span>
                          <span class="shortcut-count">{{ drawerSkillsEnriched.length }}</span>
                        </span>
                      </button>
                    </el-tooltip>
                    <!-- 定时任务快捷入口 -->
                    <el-tooltip v-if="agentCrons.length > 0" content="查看这个 Agent 绑定的自动任务，例如定时巡检、定时汇报、自动推送。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                      <button
                        :class="['skills-shortcut-btn', showCronPanel ? 'skills-shortcut-btn--active' : '']"
                        @click="showCronPanel = !showCronPanel; showSkillsPanel = false"
                      >
                        <el-icon class="shortcut-icon"><Timer /></el-icon>
                        <span class="shortcut-bottom">
                          <span class="shortcut-label">定时任务</span>
                          <span class="shortcut-count">{{ agentCrons.length }}</span>
                        </span>
                      </button>
                    </el-tooltip>
                  </div>
                </div>
              </template>

              <!-- ▼ 可折叠技能面板（在消息区上方） -->
              <transition name="skills-panel">
                <div v-if="showSkillsPanel" class="skills-inline-panel">
                  <div v-if="drawerSkillsLoading" class="skills-panel-loading">
                    <el-icon class="is-loading"><Loading /></el-icon>
                    <span>加载中...</span>
                  </div>
                  <div v-else-if="drawerSkillsEnriched.length === 0" class="skills-panel-empty">
                    <el-icon><Collection /></el-icon>
                    <span>暂无技能数据</span>
                  </div>
                  <div v-else class="skills-panel-grouped">
                    <template v-for="(group, catName) in drawerSkillsByCategory" :key="catName">
                      <!-- 分类标题（可折叠） -->
                      <div
                        class="sp-cat-header"
                        @click="toggleDrawerCat(String(catName))"
                      >
                        <span class="sp-cat-icon">{{ ownValue(DRAWER_CATEGORY_ICONS, String(catName)) || '' }}</span>
                        <span class="sp-cat-name">{{ catName }}</span>
                        <span class="sp-cat-count">{{ group.length }}</span>
                        <span class="sp-cat-chevron" :class="{ collapsed: collapsedDrawerCats.has(String(catName)) }">▾</span>
                      </div>
                      <!-- 技能列表 -->
                      <div v-show="!collapsedDrawerCats.has(String(catName))" class="skills-panel-grid">
                        <div
                          v-for="skill in group"
                          :key="skill.name"
                          :class="['sp-item', skill.enabled ? 'sp-on' : skill.installed ? 'sp-inactive' : 'sp-off']"
                        >
                          <span
                            :class="['sp-dot', skill.enabled ? 'sp-dot--on' : skill.installed ? 'sp-dot--inactive' : 'sp-dot--off']"
                            :title="skill.enabled ? '已激活' : skill.installed ? '已安装，未激活' : '未安装'"
                          />
                          <span class="sp-name-wrap">
                            <span class="sp-name">{{ skill.displayName }}</span>
                            <span v-if="skill.description" class="sp-desc" :title="skill.description">{{ skill.description }}</span>
                          </span>
                          <el-button
                            v-if="skill.installed && skill.enabled"
                            size="small" type="danger" plain
                            :loading="drawerSkillsToggling.get(skill.name)"
                            :disabled="drawerSkillsToggling.get(skill.name)"
                            @click="handleDrawerSkillToggle(skill.name, false)"
                            class="sp-btn"
                          >禁用</el-button>
                          <el-button
                            v-else-if="skill.installed && !skill.enabled"
                            size="small" type="success" plain
                            :loading="drawerSkillsToggling.get(skill.name)"
                            :disabled="drawerSkillsToggling.get(skill.name)"
                            @click="handleDrawerSkillToggle(skill.name, true)"
                            class="sp-btn"
                          >启用</el-button>
                          <span v-else class="sp-uninstalled">未装</span>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </transition>

              <!-- ▼ 可折叠定时任务面板 -->
              <transition name="skills-panel">
                <div v-if="showCronPanel" class="cron-inline-panel">
                  <div v-if="agentCronsLoading" class="skills-panel-loading">
                    <el-icon class="is-loading"><Loading /></el-icon>
                    <span>加载中...</span>
                  </div>
                  <div v-else class="cron-inline-list">
                    <div
                      v-for="cron in agentCrons"
                      :key="cron.id"
                      class="cron-inline-item"
                      @click="expandedCronId = expandedCronId === cron.id ? '' : cron.id"
                    >
                      <div class="cron-inline-header">
                        <span :class="['cron-status-dot', `cron-dot--${cron.status}`]" />
                        <span class="cron-inline-name">{{ cron.name }}</span>
                        <span class="cron-inline-schedule">{{ formatCronSchedule(cron.schedule) }}</span>
                        <span v-if="cron.state?.lastRunAtMs" class="cron-inline-last">{{ formatCronTime(cron.state.lastRunAtMs) }}</span>
                        <el-icon class="cron-chevron" :class="expandedCronId === cron.id ? 'cron-chevron--open' : ''"><ArrowDown /></el-icon>
                      </div>
                      <div v-if="expandedCronId === cron.id" class="cron-inline-message" @click.stop>
                        {{ displayCronMessage(cron.payload?.message || '（无消息）') }}
                      </div>
                    </div>
                  </div>
                </div>
              </transition>

              <div ref="msgContainerRef" class="msg-scroll-wrap">
                <el-empty v-if="filteredMessages.length === 0" class="msg-card-inner empty-area" description="暂无消息" :image-size="60" />

                <div v-else class="msg-card-inner">
                  <div v-if="historyTotal > 0" class="history-hint">
                    <span v-if="historyTruncated">历史较长，已加载最近 {{ historyCount }} 条（全部历史 session 聚合）</span>
                    <span v-else>已展示全部历史聊天记录，共 {{ historyTotal }} 条（跨全部 session）</span>
                  </div>
                  <div class="messages-list-outer" @click="handleMsgImageClick">
                    <div
                      v-for="(msg, idx) in filteredMessages"
                      :key="idx"
                      class="chat-row"
                      :class="msg.role === 'user' ? 'chat-row-user' : 'chat-row-assistant'"
                    >
                      <div v-if="shouldShowMessageTime(idx)" class="chat-time-divider">
                        {{ messageTimeLabel(msg.timestamp) }}
                      </div>
                      <div class="chat-stack" :class="msg.role === 'user' ? 'chat-stack-user' : 'chat-stack-assistant'">
                        <div class="chat-speaker">
                          {{ messageSpeaker(msg) }}
                          <button class="chat-speak-btn" :class="{ playing: speakingKey === messageKey(msg) }" type="button" :title="speakingKey === messageKey(msg) ? '停止朗读' : '朗读这条(用当前音色)'" @click.stop="playMessageAudio(msg)">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                              <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                              <path v-if="speakingKey !== messageKey(msg)" d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" fill="currentColor" fill-opacity="0.9"/>
                            </svg>
                          </button>
                          <button class="chat-del-btn" type="button" title="从视图删除这条(仅隐藏,不影响Agent记忆)" @click.stop="hideMessage(msg)">删除</button>
                        </div>
                        <div
                          class="chat-bubble"
                          :class="bubbleClass(msg)"
                        >
                          <div class="bubble-label" v-if="msg.contentType === 'thinking'">思考</div>
                          <div class="bubble-label" v-else-if="msg.contentType === 'toolUse'">工具调用</div>
                          <div class="bubble-label" v-else-if="msg.contentType === 'toolResult' && msg.isError">工具错误</div>
                          <div class="bubble-label" v-else-if="msg.contentType === 'toolResult'">工具结果</div>
                          <div class="markdown-body" v-html="renderMarkdown(displayMessageContent(msg))"></div>
                          <details v-if="msg.systemNotice" class="system-notice-fold">
                            <summary>系统提示</summary>
                            <div class="system-notice-text" v-html="renderMarkdown(localizeAgentMessage(msg.systemNotice))"></div>
                          </details>
                        </div>
                        <div v-if="messageMetaText(msg)" class="chat-meta">{{ messageMetaText(msg) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-card>

            <!-- 发送区域 -->
            <div class="chat-send-area" @paste="handlePaste">
              <!-- 快捷模板 -->
              <div class="quick-tpl-bar">
                <span class="quick-tpl-label">快捷：</span>
                <el-button
                  v-for="tpl in quickTemplates"
                  :key="tpl.label"
                  size="small"
                  text
                  class="quick-tpl-btn"
                  @click="applyTemplate(tpl.text)"
                >{{ tpl.label }}</el-button>
              </div>
              <!-- 粘贴的图片预览 -->
              <div v-if="imageAttachments.length > 0" class="image-preview-strip">
                <div v-for="(img, idx) in imageAttachments" :key="idx" class="image-preview-item">
                  <img :src="img.url" class="image-preview-thumb" @click="previewImageUrl = img.url" />
                  <el-button class="image-remove-btn" size="small" circle
                    @click="imageAttachments.splice(idx, 1)">×</el-button>
                </div>
              </div>
              <!-- #17 @ 提及下拉（@ Mention Dropdown）-->
              <div v-if="mentionVisible" class="mention-dropdown">
                <div
                  v-for="(ag, idx) in mentionFiltered"
                  :key="ag.id"
                  class="mention-item"
                  :class="{ active: mentionIndex === idx }"
                  @mousedown.prevent="selectMention(ag)"
                >
                  <img class="mention-avatar" :src="ag.avatar" :alt="ag.name" @error="setDefaultAvatar" />
                  <span class="mention-name">{{ ag.name }}</span>
                  <span class="mention-id">@{{ ag.id }}</span>
                </div>
                <div v-if="mentionFiltered.length === 0" class="mention-empty">无匹配 Agent</div>
              </div>
              <!-- 实时情绪徽章 -->
              <div v-if="sentimentBadgeStyle" class="sentiment-badge-row">
                <span class="sentiment-badge" :style="{ color: sentimentBadgeStyle.color, borderColor: sentimentBadgeStyle.color }">
                  {{ sentimentBadgeStyle.label }}
                </span>
                <span class="sentiment-hint">已感知情绪，回复语气将自动调整</span>
              </div>
              <div class="send-row">
                <el-input v-model="chatInput" type="textarea" :rows="2"
                  ref="chatInputRef"
                  placeholder="输入消息... (Enter 发送，@ 提及 Agent，Ctrl+Enter 换行，支持粘贴图片)" :disabled="sending"
                  @keydown="handleInputKeydown"
                  @input="handleChatInput" />
                <el-button type="primary" :icon="Promotion" :loading="sending" :disabled="sending" @click="sendMessage">
                  发送
                </el-button>
              </div>
            </div>
          </div>

          <!-- 手动加载历史时左侧消息区域的 loading 遮罩 -->
          <div v-if="loadingHistory" class="left-loading-overlay">
            <el-icon class="is-loading" :size="28">
              <Loading />
            </el-icon>
            <span>正在加载会话历史...</span>
          </div>
        </div>

        <!-- ========= 右侧：会话信息 + 上下文使用 + 操作 ========= -->
        <div class="drawer-right">
        <el-scrollbar class="drawer-right-scroll" view-class="drawer-right-scroll-view">

          <!-- 实时活动（运行中时显示） -->
          <el-card v-if="agent.status === 'running'" class="detail-section live-activity-card" shadow="never">
            <template #header>
              <div class="section-header">
                <el-tooltip content="实时展示 Agent 当前触发的任务、正在调用的工具和最近执行结果。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                  <div class="section-header-left">
                    <span class="live-header-dot" />
                    正在做什么
                  </div>
                </el-tooltip>
                <span class="live-header-time" v-if="drawerLiveSteps.length > 0">
                  实时更新
                </span>
              </div>
            </template>
            <div class="drawer-live-steps" ref="liveStepsEl">
              <div v-if="drawerLiveLoading && drawerLiveSteps.length === 0" class="drawer-live-empty">
                <el-icon class="is-loading"><Loading /></el-icon> 加载中…
              </div>
              <div v-else-if="drawerLiveSteps.length === 0" class="drawer-live-empty">暂无活动数据</div>
              <div v-else>
                <div
                  v-for="(step, i) in drawerLiveSteps"
                  :key="i"
                  class="drawer-live-row"
                  :class="`dlr-${step.type}`"
                >
                  <div class="dlr-left">
                    <span class="dlr-icon">{{ drawerStepIcon(step.type) }}</span>
                    <span class="dlr-badge">{{ drawerStepLabel(step.type) }}</span>
                  </div>
                  <div class="dlr-text">{{ drawerStepText(step) }}</div>
                </div>
              </div>
            </div>
          </el-card>

          <!-- Session Info -->
          <el-card class="detail-section" shadow="never">
            <template #header>
              <div class="section-header">
                <el-tooltip content="当前 Agent 会话的身份、模型、创建时间、最后活跃时间和运行时长。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                  <div class="section-header-left">
                    <el-icon>
                      <InfoFilled />
                    </el-icon>
                    会话信息
                  </div>
                </el-tooltip>
                <el-tooltip content="在 WebUI 中打开此会话" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                  <el-button
                    :icon="Link"
                    link
                    @click="openSessionInWebUI"
                  />
                </el-tooltip>
              </div>
            </template>

            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">当前会话</span>
                <span class="info-value">{{ sessionDisplayName }}</span>
              </div>
              <div class="info-item" v-if="agent.model">
                <span class="info-label">模型</span>
                <span class="info-value">{{ agent.model }}</span>
              </div>
              <div class="info-item" v-if="agent.createdAt">
                <span class="info-label">创建时间</span>
                <span class="info-value">{{ formatTime(agent.createdAt) }}</span>
              </div>
              <div class="info-item" v-if="agent.lastActivity">
                <span class="info-label">最后活跃</span>
                <span class="info-value">{{ formatTime(String(agent.lastActivity)) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">运行时长</span>
                <span class="info-value">{{ formattedDuration }}</span>
              </div>
            </div>
          </el-card>

          <!-- Token / 上下文使用 -->
          <el-card class="detail-section" shadow="never">
            <template #header>
              <el-tooltip content="显示当前会话已经使用了多少 Token、上下文上限和使用率；接近上限时回复可能变慢或需要重置。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                <div class="section-header">
                  <el-icon>
                    <Coin />
                  </el-icon>
                  上下文使用
                </div>
              </el-tooltip>
            </template>

            <div class="token-usage-panel">
              <template v-if="agent.tokenUsage">
                <div class="token-stat-row">
                  <div class="token-stat">
                    <div class="stat-value">{{ formatTokenZh(agent.tokenUsage.current) }}</div>
                    <div class="stat-label">已用 Token</div>
                  </div>
                  <div class="token-stat">
                    <div class="stat-value">{{ formatTokenZh(agent.tokenUsage.max) }}</div>
                    <div class="stat-label">上下文上限</div>
                  </div>
                  <div class="token-stat">
                    <div class="stat-value" :class="percentageClass">
                      {{ agent.tokenUsage.percentage }}%
                    </div>
                    <div class="stat-label">使用率</div>
                  </div>
                </div>
                <el-progress :percentage="agent.tokenUsage.percentage" :status="tokenProgressStatus" :stroke-width="12"
                  :show-text="false" class="token-progress" />
              </template>
              <template v-else>
                <div class="token-stat-row">
                  <div class="token-stat">
                    <div class="stat-value">{{ agentHistoricalTokens > 0 ? formatTokenZh(agentHistoricalTokens) : '—' }}</div>
                    <div class="stat-label">累计 Token</div>
                  </div>
                  <div class="token-stat">
                    <div class="stat-value">—</div>
                    <div class="stat-label">上下文上限</div>
                  </div>
                  <div class="token-stat">
                    <div class="stat-value">—%</div>
                    <div class="stat-label">使用率</div>
                  </div>
                </div>
                <el-progress :percentage="0" :stroke-width="12" :show-text="false" class="token-progress token-progress--inactive" />
                <div class="token-no-data">飞书会话按累计统计，无实时上下文窗口</div>
              </template>
            </div>
          </el-card>

          <!-- 历史 Token & 模型消耗明细 -->
          <el-card class="detail-section" shadow="never" v-if="agentHistoricalTokens > 0 || agentModelBreakdown.length > 0">
            <template #header>
              <el-tooltip content="按模型统计这个 Agent 历史消耗的 Token，用来判断主要消耗来自哪个模型。" placement="bottom" popper-class="agent-help-tooltip" :show-after="120">
                <div class="section-header">
                  <el-icon><Odometer /></el-icon>
                  历史 Token 消耗
                </div>
              </el-tooltip>
            </template>
            <div class="hist-token-panel">
              <div class="hist-total-row">
                <span class="hist-label">累计消耗</span>
                <span class="hist-value">{{ formatTokens(agentHistoricalTokens) }}</span>
              </div>
              <div v-if="agentModelBreakdown.length > 0" class="model-breakdown">
                <el-tooltip
                  v-for="row in agentModelBreakdown"
                  :key="row.model"
                  :content="`${row.displayName}（${row.model}） · ${formatTokens(row.tokens)} · ${row.pct}%`"
                  placement="left"
                  popper-class="agent-help-tooltip"
                  :show-after="120"
                >
                <div class="model-breakdown-row">
                  <span
                    class="model-logo model-logo--small"
                    :class="`model-logo--${modelLogoKey(row.model)}`"
                    :title="modelCompanyName(row.model)"
                  >
                    <img
                      v-if="modelLogoSrc(row.model)"
                      class="model-logo-img"
                      :src="modelLogoSrc(row.model)"
                      :alt="modelCompanyName(row.model)"
                    />
                    <span v-else>{{ modelLogoText(row.model) }}</span>
                  </span>
                  <span class="model-label">{{ row.displayName }}</span>
                  <span class="model-tokens">{{ formatTokens(row.tokens) }}</span>
                  <el-progress
                    :percentage="clampPercentage(row.pct)"
                    :stroke-width="5"
                    :show-text="false"
                    :color="row.color"
                    class="model-pct-bar"
                  />
                  <span class="model-pct-text">{{ row.pct }}%</span>
                </div>
                </el-tooltip>
              </div>
            </div>
          </el-card>

          <!-- Extra Details -->
          <el-card class="detail-section" shadow="never" v-if="agent.details">
            <template #header>
              <div class="section-header">
                <el-icon>
                  <Document />
                </el-icon>
                原始详情
              </div>
            </template>
            <pre class="raw-details">{{ JSON.stringify(agent.details, null, 2) }}</pre>
          </el-card>

          <!-- ========= 智能增强面板 ========= -->
          <CognitivePanel :agent-id="drawerAgentId" :last-analysis="lastCognitiveAnalysis" />

        </el-scrollbar>

        <!-- Action Buttons（不参与滚动，固定在右下） -->
        <div class="action-bar action-bar--sticky">
          <!-- Agent 控制按钮 -->
          <el-tooltip content="重新加载这个 Agent 的配置和会话运行状态，适合卡住或配置更新后使用。" placement="top" popper-class="agent-help-tooltip" :show-after="120">
            <el-button
              size="small"
              :icon="RefreshRight"
              :loading="agentControlling === 'restart'"
              @click="agentControl('restart')"
            >重启</el-button>
          </el-tooltip>
          <el-tooltip content="暂停这个 Agent 接收和处理新消息，可以临时节省 Token 消耗。" placement="top" popper-class="agent-help-tooltip" :show-after="120">
            <el-button
              size="small"
              :icon="VideoPause"
              :loading="agentControlling === 'pause'"
              @click="agentControl('pause')"
            >暂停</el-button>
          </el-tooltip>
          <div class="action-bar-spacer" />
          <el-tooltip content="清空当前上下文并重新开始会话。历史记录仍可查看，但当前 Agent 会丢掉这轮上下文记忆。" placement="top" popper-class="agent-help-tooltip" :show-after="120">
            <el-button class="reset-session-btn" type="danger" :icon="Refresh" @click="handleResetSession" :loading="resetting">
              重置会话
            </el-button>
          </el-tooltip>
          <el-tooltip content="加载这个 Agent 的历史聊天记录，方便回看之前说过什么、做过什么。" placement="top" popper-class="agent-help-tooltip" :show-after="120">
            <el-button class="session-history-btn" :icon="View" @click="loadHistory()" :loading="loadingHistory">
              历史
            </el-button>
          </el-tooltip>
          <el-tooltip content="按日期汇总历史任务，快速查看每天触发了哪些任务、执行了什么、结果如何。" placement="top" popper-class="agent-help-tooltip" :show-after="120">
            <el-button class="session-summary-btn" :icon="Calendar" @click="openDailySummary()" :loading="dailySummaryLoading">
              历史总结
            </el-button>
          </el-tooltip>
        </div>
        </div>
      </div>
    </template>
    <!-- 图片放大预览 -->
    <el-image-viewer v-if="previewImageUrl" :url-list="[previewImageUrl]" :z-index="4000" hide-on-click-modal
      @close="previewImageUrl = ''" />
  </el-drawer>

  <Teleport to="body">
    <AgentVoiceStage
      v-if="drawerVisible && agent"
      :agent-key="agent.key"
      :agent-name="displayAgentName"
      :avatar-src="drawerAvatarSrc"
      :call-state="voiceCall.callState.value"
      :audio-level="voiceCall.audioLevel.value"
      :transcript="voiceCall.transcript.value"
      :response-text="voiceCall.responseText.value"
      :error="voiceCall.error.value"
      :is-muted="voiceCall.isMuted.value"
      :elapsed-seconds="voiceCall.elapsedSeconds.value"
      @start="voiceCall.startCall"
      @end="voiceCall.endCall"
      @interrupt="voiceCall.interrupt"
      @toggle-mute="voiceCall.toggleMute"
      @finish="voiceCall.finishTurn"
    />
  </Teleport>

  <!-- 历史总结（按日期：每天做了什么 / 任务·执行·结果）-->
  <el-dialog
    v-model="dailySummaryVisible"
    :title="`${agent?.displayName || agent?.name || ''} · 历史总结`"
    width="860px"
    top="5vh"
    :append-to-body="true"
    destroy-on-close
    class="daily-summary-dialog"
  >
    <div class="ds-toolbar">
      <span class="ds-range">最近</span>
      <el-radio-group v-model="dailySummaryDays" size="small" @change="reloadDailySummary">
        <el-radio-button :value="7">7 天</el-radio-button>
        <el-radio-button :value="14">14 天</el-radio-button>
        <el-radio-button :value="30">30 天</el-radio-button>
      </el-radio-group>
      <span v-if="dailySummaryData" class="ds-stat">共 {{ dailySummaryData.totalSessions }} 个会话 · {{ dailySummaryData.daysList?.length || 0 }} 天</span>
    </div>
    <div v-if="dailySummaryLoading" class="ds-loading">正在汇总历史…</div>
    <el-scrollbar v-else height="74vh">
      <div v-if="!dailySummaryData || !dailySummaryData.daysList || dailySummaryData.daysList.length === 0" class="ds-empty">
        最近 {{ dailySummaryDays }} 天没有可展示的活动记录
      </div>
      <div v-else class="ds-days">
        <div v-for="day in dailySummaryData.daysList" :key="day.date" class="ds-day">
          <div class="ds-day-head">
            <span class="ds-day-date">{{ day.date }}</span>
            <span class="ds-day-meta">{{ day.sessionCount }} 个会话 · 工具 {{ day.totalTools }} 次</span>
          </div>
          <div class="ds-ai">
            <span class="ds-ai-tag">AI 摘要<template v-if="aiSummaries[day.date]"> · {{ aiSummaries[day.date]!.model }}</template></span>
            <span v-if="aiLoading[day.date]" class="ds-ai-loading">{{ isTodayStr(day.date) ? 'DeepSeek 生成中…' : '本地模型生成中,首次约需半分钟…' }}</span>
            <span v-else-if="aiErrors[day.date]" class="ds-ai-err">{{ aiErrors[day.date] }}</span>
            <p v-else-if="aiSummaries[day.date]" class="ds-ai-text">{{ aiSummaries[day.date]!.summary }}</p>
          </div>
          <div class="ds-sessions">
            <div v-for="s in day.sessions" :key="s.sessionId" class="ds-session">
              <div class="ds-session-top">
                <span class="ds-time">{{ s.time }}</span>
                <span class="ds-trigger" :class="s.trigger">{{ s.trigger === 'cron' ? '定时' : '用户' }}</span>
                <span class="ds-task">{{ s.task }}</span>
              </div>
              <div class="ds-did"><span class="ds-label">做了</span>{{ s.toolSummary }}</div>
              <div class="ds-result"><span class="ds-label">结果</span>{{ s.result }}</div>
            </div>
          </div>
        </div>
      </div>
    </el-scrollbar>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import 'highlight.js/styles/atom-one-dark.css'
import { renderSafeMarkdown } from '../utils/safe-content.mjs'
import type { AgentInfo } from '../stores/agent'
import { useAgentStore } from '../stores/agent'
import AgentVoiceStage from './AgentVoiceStage.vue'
import CognitivePanel from './CognitivePanel.vue'
import { useBrowserVoiceCall } from '../composables/useBrowserVoiceCall'
import { loadAgentVoiceSettings } from '../composables/useAgentVoiceSettings'
import { ToolRestrictedError } from '../api/gateway'
import { formatTokenZh } from '../utils/tokenFormat'
import { setDefaultAvatar } from '../utils/avatarFallback'
import { buildAgentPresentationOptions, normalizeAgentAvatarSource } from '../utils/agent-presentation.mjs'
import { createSafeRecord, ownValue } from '../utils/safe-record.mjs'
import { clampPercentage, modelTokenPercentages } from '../utils/percentage.mjs'
import { ElMessage, ElMessageBox, ElImageViewer, ElNotification } from 'element-plus'
import { getSkills, toggleSkill } from '../api/system'
import {
  UserFilled,
  InfoFilled,
  Coin,
  Odometer,
  Collection,
  ChatDotRound,
  Document,
  Refresh,
  View,
  Calendar,
  Loading,
  CircleCheckFilled,
  Clock,
  WarningFilled,
  CircleCloseFilled,
  QuestionFilled,
  Timer,
  Promotion,
  Link,
  ArrowDown,
  RefreshRight,
  VideoPause,
} from '@element-plus/icons-vue'

interface MessageItem {
  role: string
  contentType: string
  content: string
  senderName?: string
  isError?: boolean
  timestamp?: string | null
  model?: string
  triggerType?: 'user' | 'cron' | 'model' | 'system' | 'tool'
  triggerName?: string
  systemNotice?: string
}

interface QuickTemplate {
  label: string
  text: string
}

const props = defineProps<{
  visible: boolean
  agentData: AgentInfo | null
  autoFocusInput?: boolean
}>()

const chatInputRef = ref<any>(null)

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'view-execution', value: AgentInfo): void
  (e: 'closed'): void
}>()

const store = useAgentStore()

// Local state
const drawerVisible = computed({
  get: () => props.visible,
  set: (val: boolean) => emit('update:visible', val),
})

const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)

const drawerSize = computed(() => {
  const width = viewportWidth.value
  if (width <= 1380) return `${Math.min(1040, width)}px`

  const voicePanelWidth = Math.min(720, Math.max(480, width * 0.34))
  return `${width - voicePanelWidth}px`
})

function updateViewportWidth(): void {
  viewportWidth.value = window.innerWidth
}

const agent = computed(() => {
  // Always try to get latest from store
  if (!props.agentData) return null
  const latest = store.getAgentByKey(props.agentData.key)
  return latest || props.agentData
})

const historyCount = ref(0)
const historyTruncated = ref(false)
const historyTotal = ref(0)

// 历史总结（按日期）
const dailySummaryVisible = ref(false)
const dailySummaryLoading = ref(false)
const dailySummaryDays = ref(14)
const dailySummaryData = ref<any>(null)

async function openDailySummary(): Promise<void> {
  const a = agent.value
  if (!a?.key) return
  const agentId = (a.key || '').split(':')[1] || ''
  if (!agentId) return
  dailySummaryVisible.value = true
  dailySummaryLoading.value = true
  dailySummaryData.value = null
  try {
    const resp = await fetch(`/api/agent-daily-summary?agentId=${encodeURIComponent(agentId)}&days=${dailySummaryDays.value}`)
    if (resp.ok) dailySummaryData.value = await resp.json()
  } catch (_) { /* ignore */ }
  finally { dailySummaryLoading.value = false }
  aiSummaries.value = createSafeRecord()
  aiLoading.value = createSafeRecord()
  aiErrors.value = createSafeRecord()
  generateAiSummaries()
}
function reloadDailySummary(): void { openDailySummary() }

// ── AI 摘要(昨天及以前=本地模型,今天=DeepSeek) ──
const aiSummaries = ref<Record<string, { summary: string; model: string } | undefined>>(createSafeRecord())
const aiLoading = ref<Record<string, boolean>>(createSafeRecord())
const aiErrors = ref<Record<string, string>>(createSafeRecord())

function isTodayStr(date: string): boolean {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return date >= `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

async function generateAiSummaries(): Promise<void> {
  const data = dailySummaryData.value
  const a = agent.value
  if (!data?.daysList?.length || !a?.key) return
  const agentId = (a.key || '').split(':')[1] || ''
  if (!agentId) return
  // 逐日顺序生成(本地模型不并发),今天的(列表第一个)最快
  for (const day of data.daysList) {
    const date = String(day.date)
    if (ownValue(aiSummaries.value, date) || ownValue(aiLoading.value, date)) continue
    const material = (day.sessions || []).map((s: any) =>
      `${s.time} [${s.trigger === 'cron' ? '定时' : '用户'}] ${s.task}\n做了: ${s.toolSummary}\n结果: ${s.result}`
    ).join('\n\n')
    if (!material.trim()) continue
    aiLoading.value[date] = true
    try {
      const resp = await fetch('/api/day-summary-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, date, material }),
      })
      const j = await resp.json()
      if (resp.ok && j.summary) {
        aiSummaries.value[date] = { summary: j.summary, model: j.model }
      } else {
        aiErrors.value[date] = `生成失败: ${j.error || '未知错误'}`
      }
    } catch (e: any) {
      aiErrors.value[date] = `生成失败: ${e.message}`
    } finally {
      aiLoading.value[date] = false
    }
    // 对话框已关闭则停止后续生成
    if (!dailySummaryVisible.value) break
  }
}
const recentMessages = ref<MessageItem[]>([])
function hiddenKeysStorageKey(): string {
  return `openclaw-hidden-msgs:${agent.value?.key || 'default'}`
}
function loadHiddenKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(hiddenKeysStorageKey())
    return new Set(raw ? JSON.parse(raw) as string[] : [])
  } catch { return new Set() }
}
const hiddenMessageKeys = ref<Set<string>>(loadHiddenKeys())
function messageKey(msg: MessageItem): string {
  return `${msg.timestamp || ''}|${msg.role}|${(msg.content || '').slice(0, 40)}`
}
function hideMessage(msg: MessageItem): void {
  const next = new Set(hiddenMessageKeys.value).add(messageKey(msg))
  hiddenMessageKeys.value = next
  try { localStorage.setItem(hiddenKeysStorageKey(), JSON.stringify([...next])) } catch { /* ignore */ }
}

// 朗读某条消息:用当前音色(宝贝)合成并播放
const speakingKey = ref<string>('')
let speakAudio: HTMLAudioElement | null = null
let speakAudioUrl = ''
function stripForSpeech(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
// 情绪 → CosyVoice 自然语言指令（与语音设置面板一致）
const EMOTION_INSTRUCT: Record<string, string> = {
  '': '',
  happy: '用开心、上扬的语气说',
  gentle: '用温柔、关心的语气说',
  excited: '用兴奋、热情的语气说',
  serious: '用严肃、认真的语气说',
  sad: '用低落、难过的语气说',
}
async function playMessageAudio(msg: MessageItem): Promise<void> {
  const key = messageKey(msg)
  // 再点一次=停止
  if (speakingKey.value === key && speakAudio) {
    speakAudio.pause(); speakAudio = null
    if (speakAudioUrl) { URL.revokeObjectURL(speakAudioUrl); speakAudioUrl = '' }
    speakingKey.value = ''
    return
  }
  const text = stripForSpeech(displayMessageContent(msg))
  if (!text) { ElMessage.info('这条没有可朗读的文字'); return }
  // 「我」说的话 → 永远用数字分身(me)的音色（不管在哪个 Agent 页面）；
  // Agent 说的话 → 用该 Agent 自己的音色
  let voiceId = ''
  let provider = 'cosyvoice'
  let instruction = ''
  const isMine = msg.role === 'user'
  const targetAgentId = isMine ? 'me' : ((agent.value?.key || '').split(':')[1] || '')
  const targetKey = isMine ? 'agent:me:main' : agent.value?.key
  try {
    const vr = await fetch(`/api/voice/voices?agentId=${encodeURIComponent(targetAgentId)}`).then(r => r.json())
    const cloned: Array<{ voiceId: string; name: string; provider: string }> = vr.cloned || []
    const settings = loadAgentVoiceSettings(targetKey)
    if (settings.emotion === 'auto') {
      // 自动：让 LLM 读这句话判断该用什么情绪
      try {
        const er = await fetch('/api/voice/auto-emotion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).then(r => r.json())
        instruction = EMOTION_INSTRUCT[er.emotion || ''] || ''
      } catch { instruction = '' }
    } else {
      instruction = EMOTION_INSTRUCT[settings.emotion || ''] || ''
    }
    if (settings.backendVoiceId && cloned.find(v => v.voiceId === settings.backendVoiceId)) {
      voiceId = settings.backendVoiceId
      provider = cloned.find(v => v.voiceId === voiceId)?.provider || settings.backendProvider || 'cosyvoice'
    } else if (cloned[0]) {
      voiceId = cloned[0].voiceId; provider = cloned[0].provider
    }
  } catch { /* ignore */ }
  if (!voiceId) {
    ElMessage.warning(isMine ? '数字分身（你的数字分身）还没设置音色，去数字分身的语音设置里选/克隆「我」的声音' : '这个 Agent 还没设置音色,先去它的语音设置里选/克隆一个')
    return
  }
  speakingKey.value = key
  try {
    const resp = await fetch('/api/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, provider: provider || undefined, instruction: instruction || undefined }),
    })
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}))
      throw new Error(e.error || `HTTP ${resp.status}`)
    }
    const blob = await resp.blob()
    if (!blob.size) throw new Error('合成返回空音频')
    if (speakAudioUrl) URL.revokeObjectURL(speakAudioUrl)
    speakAudioUrl = URL.createObjectURL(blob)
    speakAudio = new Audio(speakAudioUrl)
    speakAudio.onended = () => { speakingKey.value = ''; if (speakAudioUrl) { URL.revokeObjectURL(speakAudioUrl); speakAudioUrl = '' } }
    await speakAudio.play()
  } catch (e: any) {
    speakingKey.value = ''
    ElMessage.error('朗读失败：' + (e?.message || '未知错误'))
  }
}
const loadingHistory = ref(false)
const resetting = ref(false)
const showSkillsPanel = ref(false)
const showCronPanel = ref(false)

function latestAssistantVoiceSnapshot(): { signature: string; text: string } | null {
  for (let i = recentMessages.value.length - 1; i >= 0; i--) {
    const msg = recentMessages.value[i]
    if (msg.role !== 'assistant' || msg.contentType !== 'text') continue
    const text = displayMessageContent(msg).trim()
    if (!text || /^无需回复/.test(text) || /^模型连通正常/.test(text)) continue
    return {
      signature: `${msg.timestamp || ''}|${text}`,
      text,
    }
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForVoiceAgentReply(beforeSignature: string): Promise<string | null> {
  const timeoutAt = Date.now() + 90_000
  while (Date.now() < timeoutAt && drawerVisible.value) {
    await delay(500)   // 轮询更密：模型答完后最多 0.5s 就被检测到（原来 1.8s）
    await loadHistory(true, true)
    const latest = latestAssistantVoiceSnapshot()
    if (latest && latest.signature !== beforeSignature) {
      return latest.text
    }
  }
  return null
}

async function handleVoiceUtterance(text: string): Promise<string | null> {
  if (!agent.value?.key) throw new Error('当前没有可用 Agent 会话')
  if (sending.value) throw new Error('上一条消息还在发送，请稍等')

  const before = latestAssistantVoiceSnapshot()?.signature || ''
  sending.value = true
  try {
    await store.sendAgentMessage(agent.value.key, text)
    await loadHistory(true, true)
  } finally {
    sending.value = false
  }

  const reply = await waitForVoiceAgentReply(before)
  if (!reply) {
    return '我已经把语音消息发给 Agent 了，它还在处理，稍后你可以在会话里看到结果。'
  }
  return reply
}

const voiceCall = useBrowserVoiceCall({
  onUtterance: handleVoiceUtterance,
  getVoiceSettings: () => loadAgentVoiceSettings(agent.value?.key),
  getWakeWords: () => [agent.value?.displayName, agent.value?.name, agent.value?.label]
    .map(value => String(value || '').trim())
    .filter(Boolean),
})

// ── Sprint 5: Agent 控制 + 快捷模板 ──
const agentControlling = ref<string | null>(null)

async function agentControl(action: 'restart' | 'pause') {
  const agentId = agent.value?.key?.split(':')[1]
  if (!agentId) return
  agentControlling.value = action
  try {
    if (action === 'restart') {
      // 用 /reset 消息触发 agent 重载
      const resp = await fetch('/api/agent-send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, message: '/reset' }),
      })
      const data = await resp.json()
      if (data.ok !== false) ElMessage.success('已发送重载指令，Agent 将重启配置')
      else ElMessage.error(data.error || '重启失败')
    } else {
      ElMessage.info('暂停功能需要 openclaw CLI 支持，当前版本暂不可用')
    }
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    agentControlling.value = null
  }
}

// 快捷模板：和右下角“快捷发送”共用同一套配置
const DEFAULT_TEMPLATES: QuickTemplate[] = [
  { label: '汇报状态', text: '请汇报当前状态' },
  { label: '检查异常', text: '请检查是否有异常' },
  { label: '继续任务', text: '请继续处理当前任务' },
  { label: '总结进展', text: '请总结最近进展' },
]

const quickTemplates = ref<QuickTemplate[]>([...DEFAULT_TEMPLATES])

function quickTemplateLabel(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > 12 ? `${clean.slice(0, 12)}...` : clean
}

function normalizeQuickTemplates(raw: unknown): QuickTemplate[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: QuickTemplate[] = []
  for (const item of raw) {
    const text = typeof item === 'string'
      ? item.trim()
      : String((item as { text?: unknown })?.text || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    const label = typeof item === 'object' && item && typeof (item as { label?: unknown }).label === 'string'
      ? String((item as { label: string }).label).trim() || quickTemplateLabel(text)
      : quickTemplateLabel(text)
    out.push({ label, text })
    if (out.length >= 20) break
  }
  return out
}

async function loadQuickTemplates(): Promise<void> {
  try {
    const resp = await fetch('/api/quick-message-config')
    const data = await resp.json()
    if (!resp.ok) throw new Error(data?.error || '读取快捷模板失败')
    const configured = normalizeQuickTemplates(data?.config?.templates)
    const defaults = normalizeQuickTemplates(data?.defaults?.templates)
    quickTemplates.value = configured.length ? configured : defaults.length ? defaults : [...DEFAULT_TEMPLATES]
  } catch { /* ignore */ }
}

function onQuickMessageConfigUpdated(): void {
  void loadQuickTemplates()
}

function applyTemplate(text: string) {
  chatInput.value = text
  nextTick(() => chatInputRef.value?.focus?.())
}

// Chat send
const chatInput = ref('')
const sending = ref(false)
const msgContainerRef = ref<HTMLElement | null>(null)

// 认知引擎：实时情绪徽章
const sentimentInfo = ref<{ valence: number; urgency: number; frustration: number; label: string } | null>(null)
const lastCognitiveAnalysis = ref<any>(null)
let sentimentTimer: ReturnType<typeof setTimeout> | null = null

async function fetchSentiment(text: string) {
  if (!text.trim()) { sentimentInfo.value = null; lastCognitiveAnalysis.value = null; return }
  try {
    const r = await fetch(`/api/cognitive/analyze?text=${encodeURIComponent(text)}`)
    const d = await r.json()
    if (d.ok) {
      sentimentInfo.value = d.sentiment
      lastCognitiveAnalysis.value = d
    }
  } catch { /* ignore */ }
}

const sentimentBadgeStyle = computed(() => {
  const s = sentimentInfo.value
  if (!s) return null
  if (s.frustration > 0.4) return { color: '#e6a23c', label: s.label }
  if (s.urgency > 0.5) return { color: '#f56c6c', label: s.label }
  if (s.valence > 0.3) return { color: '#67c23a', label: s.label }
  if (s.valence < -0.2) return { color: '#909399', label: s.label }
  return null
})

// ─── #17 @ 提及（@ Mention）功能 ──────────────────────────────────────────────
const mentionAgents = computed(() => buildAgentPresentationOptions(store.agents))

const mentionVisible = ref(false)
const mentionQuery = ref('')
const mentionIndex = ref(0)
const mentionStart = ref(-1) // @ 符号在字符串中的位置

const mentionFiltered = computed(() => {
  const q = mentionQuery.value.toLowerCase()
  if (!q) return mentionAgents.value
  return mentionAgents.value.filter(a =>
    a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  )
})

/** 输入框内容变化时，检测 @ 并更新 mention 状态 */
function handleChatInput(): void {
  const text = chatInput.value
  // 找出光标位置（通过 textarea 的 selectionStart）
  const ta = chatInputRef.value?.textarea || chatInputRef.value?.input
  const pos = ta ? ta.selectionStart : text.length
  // 向左找最近的 @ 符号
  const before = text.slice(0, pos)
  const atIdx = before.lastIndexOf('@')
  if (atIdx === -1) {
    mentionVisible.value = false
  } else {
    // @ 和光标之间不能有空格（空格=结束 mention）
    const between = before.slice(atIdx + 1)
    if (between.includes(' ') || between.includes('\n')) {
      mentionVisible.value = false
    } else {
      mentionStart.value = atIdx
      mentionQuery.value = between
      mentionIndex.value = 0
      mentionVisible.value = true
    }
  }

  // 实时情绪分析（防抖 600ms）
  if (sentimentTimer) clearTimeout(sentimentTimer)
  if (!text.trim()) { sentimentInfo.value = null; return }
  sentimentTimer = setTimeout(() => fetchSentiment(text), 600)
}

/** 选中 mention 选项，将 @query 替换为 @agentId */
function selectMention(ag: { id: string; name: string; avatar: string }): void {
  const text = chatInput.value
  const insertText = `@${ag.id} `
  // 替换 @query 部分
  chatInput.value = text.slice(0, mentionStart.value) + insertText + text.slice(mentionStart.value + 1 + mentionQuery.value.length)
  mentionVisible.value = false
  nextTick(() => {
    const ta = chatInputRef.value?.textarea || chatInputRef.value?.input
    if (ta) {
      const newPos = mentionStart.value + insertText.length
      ta.setSelectionRange(newPos, newPos)
      ta.focus()
    }
  })
}

// REC-036: 消息类型过滤
const showThinking = ref(true)
const showTool = ref(false)

const filteredMessages = computed(() => {
  return recentMessages.value.filter(msg => {
    if (msg.contentType === 'thinking') return showThinking.value
    if (msg.contentType === 'toolUse' || msg.contentType === 'toolResult') return showTool.value
    return true
  }).filter((m: MessageItem) => !hiddenMessageKeys.value.has(messageKey(m)))
})

function messageTsMs(msg?: MessageItem): number {
  if (!msg?.timestamp) return 0
  const n = Date.parse(msg.timestamp)
  return Number.isFinite(n) ? n : 0
}

function shouldShowMessageTime(index: number): boolean {
  const msg = filteredMessages.value[index]
  const ts = messageTsMs(msg)
  if (!ts) return false
  if (index === 0) return true
  const prev = filteredMessages.value[index - 1]
  const prevTs = messageTsMs(prev)
  if (!prevTs) return true
  const d = new Date(ts)
  const p = new Date(prevTs)
  const dayChanged = d.getFullYear() !== p.getFullYear() || d.getMonth() !== p.getMonth() || d.getDate() !== p.getDate()
  return dayChanged || ts - prevTs >= 5 * 60 * 1000
}

function messageTimeLabel(timestamp?: string | null): string {
  const ts = timestamp ? Date.parse(timestamp) : NaN
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterday = `${yesterdayDate.getFullYear()}-${pad(yesterdayDate.getMonth() + 1)}-${pad(yesterdayDate.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (date === today) return time
  if (date === yesterday) return `昨天 ${time}`
  return `${date} ${time}`
}

function messageMetaText(msg: MessageItem): string {
  const parts: string[] = []
  if (msg.role === 'user') {
    if (msg.triggerType === 'cron') parts.push(`系统定时任务${msg.triggerName ? `「${msg.triggerName}」` : ''}触发`)
    else if (msg.triggerType === 'model') parts.push(`模型${msg.model ? `「${modelDisplayName(msg.model)}」` : ''}触发`)
    else parts.push('你发送的消息')
  } else if (msg.contentType === 'toolUse' || msg.contentType === 'toolResult') {
    parts.push('工具信息')
  } else if (msg.contentType === 'thinking') {
    parts.push('思考信息')
  } else {
    parts.push(`Agent 回复${msg.model ? ` · ${modelDisplayName(msg.model)}` : agent.value?.model ? ` · ${modelDisplayName(agent.value.model)}` : ''}`)
  }
  const time = messageTimeLabel(msg.timestamp)
  if (time) parts.push(time)
  return parts.join(' · ')
}

// REC-041: 通过同源服务端代理在 WebUI 中打开当前会话。
function openSessionInWebUI(): void {
  if (!agent.value?.key) return
  const sessionKey = agent.value.key || ''
  window.open(`/gateway-api/chat?session=${encodeURIComponent(sessionKey)}`, '_blank', 'noopener,noreferrer')
}

// 粘贴的图片附件
interface ImageAttachment {
  url: string        // data URL 用于预览
  mediaType: string  // e.g. "image/png"
  data: string       // base64 数据（不含 data:... 前缀）
}
const imageAttachments = ref<ImageAttachment[]>([])
const previewImageUrl = ref('') // 图片预览弹窗

// Computed
const displayStatus = computed(() => {
  if (!agent.value) return '未知'
  const map: Record<string, string> = {
    running: '运行中',
    idle: '空闲',
    error: '错误',
    aborted: '已终止',
    unknown: '未知',
  }
  return map[agent.value.status] ?? agent.value.status
})

const statusTagType = computed(() => {
  if (!agent.value) return 'info'
  switch (agent.value.status) {
    case 'running': return 'warning'
    case 'idle': return 'success'
    case 'error': return 'danger'
    case 'aborted': return 'info'
    default: return 'info'
  }
})

const statusColorClass = computed(() => {
  if (!agent.value) return 'status-unknown'
  switch (agent.value.status) {
    case 'running': return 'status-running'
    case 'idle': return 'status-idle'
    case 'error': return 'status-error'
    case 'aborted': return 'status-aborted'
    default: return 'status-unknown'
  }
})

const statusIcon = computed(() => {
  if (!agent.value) return QuestionFilled
  switch (agent.value.status) {
    case 'running': return CircleCheckFilled
    case 'idle': return Clock
    case 'error': return WarningFilled
    case 'aborted': return CircleCloseFilled
    default: return QuestionFilled
  }
})

const formattedDuration = computed(() => {
  return store.formatDuration(agent.value?.elapsedMs ?? 0)
})

// ── 历史 Token 消耗（按模型拆分）──
const MODEL_COLORS: Record<string, string> = {
  'deepseek-v4-pro': '#5e5ce6',
  'MiniMax-M2.7': '#30d158',
  'claude-sonnet-4-6': '#ff9f0a',
  'claude-sonnet-4-5': '#ff9f0a',
  'claude-opus-4': '#ff9f0a',
  'gpt-4o': '#5e5ce6',
}
const MODEL_DISPLAY: Record<string, string> = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-v3': 'DeepSeek V3',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
  'MiniMax-M2.7': 'MiniMax M2.7',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-opus-4': 'Claude Opus 4',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-5': 'Claude Opus 4.5',
  'chat-latest': 'ChatGPT Latest',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-5.4-pro': 'GPT-5.4 Pro',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.5-pro': 'GPT-5.5 Pro',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'Qwen3.5-4B-OptiQ-4bit': '本地千问 Qwen3.5 4B',
  'qwen3.5': '本地千问 Qwen3.5',
  'qwen3.5:9b': '本地千问 Qwen3.5 9B',
  'qwen2.5': '本地千问 Qwen2.5',
  'gemma3:12b': '本地 Google Gemma 3 12B',
}

function modelDisplayName(model: string): string {
  const lower = String(model || '').toLowerCase()
  if (lower.includes('qwen')) return ownValue(MODEL_DISPLAY, model) || `本地千问 ${model.replace(/^.*qwen/i, 'Qwen')}`
  if (lower.includes('gemma')) return ownValue(MODEL_DISPLAY, model) || `本地 Google ${model.replace(/^.*gemma/i, 'Gemma')}`
  return ownValue(MODEL_DISPLAY, model) || model
}

const FALLBACK_COLORS = ['#bf5af2', '#ff375f', '#06b6d4', '#84cc16']
let colorIdx = 0
const dynamicColors: Record<string, string> = createSafeRecord()
function modelColor(m: string): string {
  const configured = ownValue(MODEL_COLORS, m)
  if (configured) return configured
  if (!Object.hasOwn(dynamicColors, m)) { dynamicColors[m] = FALLBACK_COLORS[colorIdx++ % FALLBACK_COLORS.length] }
  return dynamicColors[m]
}

function modelLogoKey(model: string): string {
  const m = String(model || '').toLowerCase()
  if (m.includes('deepseek')) return 'deepseek'
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gpt') || m.includes('openai')) return 'openai'
  if (m.includes('qwen')) return 'qwen'
  if (m.includes('gemma') || m.includes('google')) return 'google'
  if (m.includes('ollama') || m.includes('local') || m.includes('本地')) return 'local'
  return 'generic'
}

function modelLogoText(model: string): string {
  const key = modelLogoKey(model)
  if (key === 'deepseek') return 'DS'
  if (key === 'minimax') return 'MM'
  if (key === 'anthropic') return 'A'
  if (key === 'openai') return 'AI'
  if (key === 'qwen') return '千'
  if (key === 'google') return 'G'
  if (key === 'local') return '本'
  return 'M'
}

function modelLogoSrc(model: string): string {
  const key = modelLogoKey(model)
  if (['deepseek', 'minimax', 'anthropic', 'openai', 'qwen', 'google'].includes(key)) {
    return `/model-logos/${key}.svg`
  }
  return ''
}

function modelCompanyName(model: string): string {
  const key = modelLogoKey(model)
  if (key === 'deepseek') return 'DeepSeek'
  if (key === 'minimax') return 'MiniMax'
  if (key === 'anthropic') return 'Anthropic / Claude'
  if (key === 'openai') return 'OpenAI'
  if (key === 'qwen') return 'Alibaba Qwen'
  if (key === 'google') return 'Google'
  if (key === 'local') return '本地模型'
  return modelDisplayName(model)
}

const drawerAgentId = computed(() => {
  const parts = (agent.value?.key || '').split(':')
  return (parts[0] === 'agent' && parts.length >= 2) ? parts[1] : parts[0]
})

const drawerAvatarSrc = computed(() => {
  return normalizeAgentAvatarSource(agent.value?.avatar)
})
function onDrawerAvatarError(event: Event) {
  setDefaultAvatar(event)
}

const agentHistoricalTokens = computed(() => store.getAgentHistoricalTokens(drawerAgentId.value))

// ════════════════════════════════════════════════
// 实时活动（抽屉内右侧面板）
// ════════════════════════════════════════════════
interface DrawerLiveStep {
  type: 'trigger' | 'thinking' | 'tool' | 'toolResult' | 'text'
  name?: string
  text: string
  timestamp: string | null
}

const drawerLiveSteps = ref<DrawerLiveStep[]>([])
const drawerLiveLoading = ref(false)
const DRAWER_LIVE_INTERVAL = 2000
const DRAWER_HISTORY_INTERVAL = 2000
const BACKGROUND_DRAWER_INTERVAL = 15000
let drawerLiveTimer: ReturnType<typeof setTimeout> | null = null
const liveStepsEl = ref<HTMLElement | null>(null)

function scrollLiveToBottom() {
  nextTick(() => {
    const el = liveStepsEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function fetchDrawerLiveActivity() {
  if (agent.value?.status !== 'running') return
  try {
    const resp = await fetch(`/api/agent-live-activity?agent=${drawerAgentId.value}`)
    if (resp.ok) {
      const data = await resp.json()
      const newSteps = data.steps || []
      // 只在步骤数量变化时滚底，避免滚动抖动
      const needsScroll = newSteps.length !== drawerLiveSteps.value.length
      drawerLiveSteps.value = newSteps
      if (needsScroll) scrollLiveToBottom()
    }
  } catch { /* 静默 */ }
  drawerLiveLoading.value = false
}

function startDrawerLivePoll() {
  drawerLiveLoading.value = true
  fetchDrawerLiveActivity()
  scheduleDrawerLivePoll()
}

function clearDrawerLiveTimer() {
  if (drawerLiveTimer) {
    clearTimeout(drawerLiveTimer)
    drawerLiveTimer = null
  }
}

function scheduleDrawerLivePoll() {
  clearDrawerLiveTimer()
  if (agent.value?.status !== 'running') return
  drawerLiveTimer = setTimeout(async () => {
    await fetchDrawerLiveActivity()
    scheduleDrawerLivePoll()
  }, document.hidden ? BACKGROUND_DRAWER_INTERVAL : DRAWER_LIVE_INTERVAL)
}

function stopDrawerLivePoll() {
  clearDrawerLiveTimer()
  drawerLiveSteps.value = []
}

watch(() => agent.value?.status, (s) => {
  if (s === 'running') startDrawerLivePoll()
  else stopDrawerLivePoll()
}, { immediate: true })

// 切换 agent 时重置
watch(() => agent.value?.key, () => {
  stopDrawerLivePoll()
  if (agent.value?.status === 'running') startDrawerLivePoll()
})

function drawerStepIcon(type: string): string {
  const m: Record<string, string> = { thinking: '', tool: '', toolResult: '', text: '', trigger: '' }
  return m[type] ?? '•'
}
function drawerStepLabel(type: string): string {
  const m: Record<string, string> = { thinking: '正在思考', tool: '调用工具', toolResult: '工具结果', text: '回复', trigger: '触发任务' }
  return m[type] ?? type
}
function drawerStepText(step: DrawerLiveStep): string {
  if (step.type === 'thinking') return '思考中，内容略…'
  if (step.type === 'trigger') {
    const m = step.text.match(/\]\s*(.+)/)
    return (m ? m[1] : step.text).slice(0, 160)
  }
  if (step.type === 'tool') return humanizeToolActivity(step)
  if (step.type === 'toolResult') {
    const lines = step.text.split('\n').filter(l => l.trim())
    return lines.slice(0, 4).join('\n').slice(0, 200) || '执行完成'
  }
  const t = step.text.trim()
  if (t === 'NO_REPLY' || t.endsWith('NO_REPLY')) return '无需回复（任务静默完成）'
  if (t === 'MODEL_OK') return '模型连通正常（诊断测试回复）'
  if (t === 'ping' || t === 'pong') return '连通性测试'
  return t.slice(0, 200)
}

function humanizeToolActivity(step: DrawerLiveStep): string {
  const name = step.name || '工具'
  const raw = step.text || ''
  let command = ''
  try {
    const parsed = JSON.parse(raw)
    command = String(parsed?.command || parsed?.cmd || parsed?.input?.command || '')
  } catch {
    command = raw
  }
  if (/send-task-summary\.py/.test(command)) {
    const mode = command.match(/--mode\s+([A-Za-z0-9_-]+)/)?.[1]
    return `执行任务摘要脚本${mode ? `（模式 ${mode}）` : ''}`
  }
  if (/python3? /.test(command)) return '执行 Python 脚本'
  if (/npm run build/.test(command)) return '构建前端项目'
  if (/curl /.test(command)) return '请求接口检查状态'
  if (/bash|\/bin\/zsh|exec_command/.test(name + raw)) return command ? `执行命令：${command.slice(0, 80)}` : '执行命令'
  return `${name}${raw ? `：${raw.slice(0, 100)}` : ''}`
}

const agentModelBreakdown = computed(() => {
  const byModel = store.globalUsage.byAgentByModel?.[drawerAgentId.value]
  if (!byModel) return []
  const rows = Object.entries(byModel).map(([model, data]) => ({
    model,
    tokens: Number(data.tokens) || 0,
  }))
  return modelTokenPercentages(rows)
    .map(({ model, tokens, pct }) => ({
      model,
      displayName: modelDisplayName(model),
      tokens,
      pct,
      color: modelColor(model),
    }))
    .sort((a, b) => b.tokens - a.tokens)
})

function formatTokens(n: number): string {
  return formatTokenZh(n)
}

// ── 专属技能（读取 agents-configured + skills） ──────────────────────────────
const DRAWER_SKILL_CATEGORIES: Record<string, string[]> = {
  '飞书协作': [
    'lark-im', 'lark-task', 'lark-calendar', 'lark-doc', 'lark-wiki',
    'lark-base', 'lark-sheets', 'lark-drive', 'lark-contact', 'lark-mail',
    'lark-approval', 'lark-attendance', 'lark-event', 'lark-minutes', 'lark-okr',
    'lark-slides', 'lark-vc', 'lark-vc-agent', 'lark-whiteboard', 'lark-shared',
    'lark-apps', 'lark-markdown', 'lark-workflow-meeting-summary', 'lark-workflow-standup-report',
    'lark-openapi-explorer', 'lark-skill-maker',
    'feishu-toolkit', 'feishu-doc', 'feishu-wiki', 'feishu-drive', 'feishu-perm',
    'jw-feishu-suite', 'Feishu All-in-One',
  ],
  '开发工具': ['browser-automation', 'python-debugpy', 'node-inspect-debugger', 'spike'],
  '生产力工具': ['diagram-maker', 'canvas', 'weather', 'apple-notes', 'apple-reminders', 'Feishu Task Daily Summary'],
  '系统与安全': ['1password', 'healthcheck'],
}
const DRAWER_CATEGORY_ICONS: Record<string, string> = {
  '飞书协作': '', '开发工具': '', '生产力工具': '', '系统与安全': '', '其他': '',
}
function getDrawerSkillCategory(name: string): string {
  for (const [cat, list] of Object.entries(DRAWER_SKILL_CATEGORIES)) {
    if (list.includes(name)) return cat
  }
  return '其他'
}

// 内联技能面板折叠状态
const collapsedDrawerCats = ref<Set<string>>(new Set())
function toggleDrawerCat(cat: string) {
  const s = new Set(collapsedDrawerCats.value)
  s.has(cat) ? s.delete(cat) : s.add(cat)
  collapsedDrawerCats.value = s
}

const SKILL_DISPLAY_NAMES: Record<string, string> = {
  'lark-im': '飞书即时通讯', 'lark-task': '飞书任务', 'lark-calendar': '飞书日历',
  'lark-doc': '飞书文档', 'lark-wiki': '飞书知识库', 'lark-base': '飞书多维表格',
  'lark-sheets': '飞书电子表格', 'lark-drive': '飞书云盘', 'lark-contact': '飞书通讯录',
  'lark-mail': '飞书邮件', 'lark-approval': '飞书审批', 'lark-attendance': '飞书考勤',
  'lark-minutes': '飞书会议纪要', 'lark-okr': '飞书 OKR', 'lark-slides': '飞书幻灯片',
  'lark-vc': '飞书视频会议', 'lark-whiteboard': '飞书白板', 'lark-markdown': '飞书 Markdown',
  'lark-workflow-meeting-summary': '会议总结工作流', 'lark-workflow-standup-report': '站会报告工作流',
  'feishu-toolkit': '飞书工具包', 'feishu-doc': '飞书文档（增强）', 'feishu-wiki': '飞书知识库（增强）',
  'feishu-drive': '飞书云盘（增强）', 'feishu-perm': '飞书权限管理', 'jw-feishu-suite': '嘉维飞书套件',
  'diagram-maker': '流程图绘制', 'browser-automation': '浏览器自动化', 'python-debugpy': 'Python 调试',
  'node-inspect-debugger': 'Node.js 调试', 'spike': '技术调研工具', 'weather': '天气查询',
  'canvas': '画布工具', '1password': '密码管理器', 'apple-notes': 'Apple 备忘录',
}

interface DrawerSkill {
  name: string
  displayName: string
  installed: boolean
  enabled: boolean
  description: string
}

const drawerAgentSkillNames = ref<string[]>([])
const drawerAllSkills = ref<Map<string, { installed: boolean; enabled: boolean; description: string }>>(new Map())
const drawerSkillsLoading = ref(false)
const drawerSkillsToggling = ref<Map<string, boolean>>(new Map())

const drawerSkillsEnriched = computed<DrawerSkill[]>(() => {
  return drawerAgentSkillNames.value.map(name => {
    const info = drawerAllSkills.value.get(name)
    return {
      name,
      displayName: ownValue(SKILL_DISPLAY_NAMES, name) || name,
      installed: info?.installed ?? false,
      enabled: info?.enabled ?? false,
      description: info?.description || '',
    }
  })
})

/** 内联技能面板按分类分组 */
const drawerSkillsByCategory = computed<Record<string, DrawerSkill[]>>(() => {
  const catOrder = Object.keys(DRAWER_SKILL_CATEGORIES).concat(['其他'])
  const result: Record<string, DrawerSkill[]> = createSafeRecord()
  for (const cat of catOrder) result[cat] = []
  for (const skill of drawerSkillsEnriched.value) {
    const cat = getDrawerSkillCategory(skill.name)
    if (!Object.hasOwn(result, cat)) result[cat] = []
    result[cat].push(skill)
  }
  for (const cat of catOrder) {
    if (result[cat].length === 0) delete result[cat]
  }
  return result
})

async function fetchDrawerSkills(): Promise<void> {
  const id = drawerAgentId.value
  if (!id) return
  drawerSkillsLoading.value = true
  try {
    const [configResp, skillsResp] = await Promise.all([
      fetch('/api/agents-configured').then(r => r.ok ? r.json() : { agents: [] }).catch(() => ({ agents: [] })),
      getSkills(),
    ])
    const agentCfg = (configResp.agents || []).find((a: { id: string; skillsUnconstrained?: boolean }) => a.id === id)

    const map = new Map<string, { installed: boolean; enabled: boolean; description: string }>()
    for (const s of (skillsResp?.skills || [])) {
      const desc = (s.description || '').slice(0, 120)
      map.set(s.name, { installed: !!s.installed, enabled: !!s.enabled, description: desc })
    }
    drawerAllSkills.value = map

    if (agentCfg?.skillsUnconstrained) {
      // 没有配置 skills 限制 → 继承所有已安装技能
      drawerAgentSkillNames.value = (skillsResp?.skills || [])
        .filter((s: Record<string, unknown>) => !!s.installed)
        .map((s: Record<string, unknown>) => s.name as string)
    } else {
      drawerAgentSkillNames.value = Array.isArray(agentCfg?.skills) ? agentCfg.skills : []
    }
  } catch {
    console.error('[DrawerSkills] fetch failed')
  } finally {
    drawerSkillsLoading.value = false
  }
}

async function handleDrawerSkillToggle(skillName: string, enabled: boolean): Promise<void> {
  drawerSkillsToggling.value.set(skillName, true)
  try {
    const result = await toggleSkill(skillName, enabled)
    if (result?.success) {
      ElMessage.success(`"${ownValue(SKILL_DISPLAY_NAMES, skillName) || skillName}" 已${enabled ? '启用' : '禁用'}`)
      // 本地更新，无需重新全量拉取
      const cur = drawerAllSkills.value.get(skillName)
      drawerAllSkills.value.set(skillName, { installed: cur?.installed ?? true, enabled, description: cur?.description ?? '' })
      drawerAllSkills.value = new Map(drawerAllSkills.value) // trigger reactivity
    } else {
      ElMessage.error(result?.message ?? `切换 "${skillName}" 失败`)
    }
  } catch {
    console.error('[DrawerSkills] toggle failed')
    ElMessage.error('切换技能状态失败')
  } finally {
    drawerSkillsToggling.value.delete(skillName)
    drawerSkillsToggling.value = new Map(drawerSkillsToggling.value)
  }
}

// ── 定时任务 (Cron Jobs) ──────────────────────────────────

interface CronJob {
  id: string
  name: string
  agentId?: string
  enabled: boolean
  schedule: { kind: string; expr?: string; everyMs?: number; tz?: string }
  payload?: { message?: string; timeoutSeconds?: number }
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; consecutiveErrors?: number; lastRunStatus?: string }
  status: string
}

const agentCrons = ref<CronJob[]>([])
const agentCronsLoading = ref(false)
const expandedCronId = ref('')

async function fetchAgentCrons(): Promise<void> {
  const id = drawerAgentId.value
  if (!id) return
  agentCronsLoading.value = true
  try {
    const resp = await fetch(`/api/agent-crons?agent=${encodeURIComponent(id)}`)
    if (resp.ok) {
      const data = await resp.json()
      agentCrons.value = (data.jobs || []).sort((a: CronJob, b: CronJob) =>
        a.name.localeCompare(b.name))
    }
  } catch {
    console.error('[DrawerCrons] fetch failed')
  } finally {
    agentCronsLoading.value = false
  }
}

function formatCronSchedule(schedule: CronJob['schedule']): string {
  if (!schedule) return '?'
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs || 0
    if (ms < 60000) return `每${Math.round(ms / 1000)}秒`
    if (ms < 3600000) return `每${Math.round(ms / 60000)}分钟`
    if (ms < 86400000) return `每${Math.round(ms / 3600000)}小时`
    return `每${Math.round(ms / 86400000)}天`
  }
  if (schedule.kind === 'cron') {
    const expr = schedule.expr || ''
    const tzLabel = schedule.tz ? ` (${schedule.tz === 'Asia/Shanghai' ? '上海' : schedule.tz})` : ''
    const parts = expr.split(' ')
    if (parts.length === 5) {
      const [min, hour, dom, , dow] = parts
      const minStr = min.padStart(2, '0')
      const hourStr = hour.padStart(2, '0')
      const dowMap: Record<string, string> = { '0': '日', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' }
      if (min.startsWith('*/')) return `每${min.slice(2)}分钟${tzLabel}`
      if (hour.startsWith('*/')) return `每${hour.slice(2)}小时${tzLabel}`
      if (dom === '*' && dow === '*') return `每天 ${hourStr}:${minStr}${tzLabel}`
      if (dom === '*' && dow !== '*') {
        if (dow.includes(',')) {
          const days = dow.split(',').map(d => `周${dowMap[d] || d}`).join('/')
          return `${days} ${hourStr}:${minStr}${tzLabel}`
        }
        return `每周${dowMap[dow] || dow} ${hourStr}:${minStr}${tzLabel}`
      }
      if (dom !== '*') return `每月${dom}日 ${hourStr}:${minStr}${tzLabel}`
    }
    return expr + tzLabel
  }
  return schedule.kind || '?'
}

function formatCronTime(ms: number): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const now = Date.now()
  const diff = now - ms
  if (diff < 3600000) return `${Math.round(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}小时前`
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const isCronSession = computed(() => {
  return agent.value?.key?.includes(':cron:')
})

const drawerAvatarIcon = computed(() => {
  if (isCronSession.value) return Timer
  return UserFilled
})

const displayAgentName = computed(() => {
  return agent.value?.displayName || agent.value?.name || agent.value?.label || drawerAgentId.value || 'Agent'
})

const userDisplayName = computed(() => {
  return '我'
})

const sessionDisplayName = computed(() => {
  return displayAgentName.value || '当前会话'
})

function messageSpeaker(msg: MessageItem): string {
  if (msg.senderName) return msg.senderName
  if (msg.role === 'user') return userDisplayName.value
  if (msg.contentType === 'toolUse' || msg.contentType === 'toolResult') return '工具'
  if (msg.contentType === 'thinking') return '思考'
  return displayAgentName.value || 'Agent'
}

const percentageClass = computed(() => {
  const p = agent.value?.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'text-danger'
  if (p >= 70) return 'text-warning'
  return 'text-success'
})

const tokenProgressStatus = computed(() => {
  const p = agent.value?.tokenUsage?.percentage ?? 0
  if (p >= 90) return 'exception'
  if (p >= 70) return 'warning'
  return 'success'
})

function bubbleClass(msg: MessageItem): string {
  if (msg.role === 'user') return 'bubble-user'
  if (msg.contentType === 'image' || msg.contentType === 'file') return 'bubble-media'
  if (msg.contentType === 'thinking') return 'bubble-thinking'
  if (msg.contentType === 'toolUse' || msg.contentType === 'toolResult') {
    if (msg.isError) return 'bubble-tool-error'
    return 'bubble-tool'
  }
  return 'bubble-assistant'
}

/** 点击消息区域内的图片时放大预览 */
function handleMsgImageClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  // 找到被点击的 <img>（可能在 markdown-body 内部）
  const img = target.closest('.markdown-body img') as HTMLImageElement | null
  if (img?.src) {
    event.stopPropagation()
    previewImageUrl.value = img.src
  }
}

// Helpers
function formatTime(dateStr: string | number): string {
  if (dateStr === undefined || dateStr === null || dateStr === '' ||
      dateStr === '0' || dateStr === 0 ||
      dateStr === 'undefined' || dateStr === 'null') {
    return '—'
  }
  let d: Date
  // 纯数字 → 当作时间戳（秒或毫秒）
  if (typeof dateStr === 'number' || /^\d+$/.test(String(dateStr))) {
    let n = Number(dateStr)
    if (n > 0 && n < 1e12) n *= 1000  // 10 位秒级 → 毫秒
    d = new Date(n)
  } else {
    d = new Date(dateStr)
  }
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function cleanContent(raw: string): string {
  if (!raw) return ''
  let text = raw
  // 1. 移除 thinking 标签及内容（兼容属性、可选空白）
  text = text.replace(/<\s*thinking[^>]*>[\s\S]*?<\/\s*thinking\s*>/gi, '')
  // 2. 移除 antThinking 标签及内容（兼容属性、可选空白）
  text = text.replace(/<\s*antThinking[^>]*>[\s\S]*?<\/\s*antThinking\s*>/gi, '')
  // 3. 移除 toolCall 标签及内容（XML 风格，兼容属性）
  text = text.replace(/<\s*toolCall[^>]*>[\s\S]*?<\/\s*toolCall\s*>/gi, '')
  // 4. 移除 toolCall 自闭合处理指令 <?toolCall ... ?>
  text = text.replace(/<\?\s*toolCall[\s\S]*?\?>/gi, '')
  // 5. 合并过多空行（保留一个空行作为段落分隔），防止相邻行意外形成表格
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}

function cleanUserContent(raw: string): string {
  if (!raw) return ''
  let text = raw.trim()
  text = text.replace(/^\[cron:[^\]\s]+(?:\s+([^\]]+))?\]\s*/i, (_m, title) => {
    const name = String(title || '').trim()
    return name ? `定时任务「${name}」触发：\n` : '定时任务触发：\n'
  }).trim()
  text = text.replace(/^\[message_id:\s*[^\]]+\]\s*/i, '').trim()
  text = text.replace(/^\[[a-z_]+:[^\]]+\]\s*/i, '').trim()
  text = text.replace(/^(?:ou|oc|on|open|user|chat)_[A-Za-z0-9_-]{10,}:\s*/i, '').trim()
  text = text.replace(/^miadn:\s*/i, '').trim()
  return text
}

function displayMessageContent(msg: MessageItem): string {
  const base = msg.role === 'user' ? cleanUserContent(msg.content) : cleanContent(msg.content)
  const cleaned = stripInlineSystemNotice(base).content.trim()
  if (/^NO_REPLY$/i.test(cleaned)) return '无需回复，任务已静默完成。'
  if (/^MODEL_OK$/i.test(cleaned)) return '模型连通正常。'
  if (!cleaned && msg.systemNotice) return '已隐藏一段系统提示。'
  if (msg.role === 'user') return localizeUserVisibleMessage(cleaned)
  return localizeAgentMessage(cleaned)
}

function displayCronMessage(raw: string): string {
  return localizeAgentMessage(cleanUserContent(raw || ''))
}

function stripInlineSystemNotice(raw: string): { content: string; notice: string } {
  if (!raw) return { content: '', notice: '' }
  const notices: string[] = []
  let content = raw
  content = content.replace(/\[System:[\s\S]*?\]/g, (m) => {
    notices.push(m.replace(/^\[System:\s*/i, '').replace(/\]$/g, '').trim())
    return ''
  })
  content = content.replace(/<system[\s\S]*?<\/system>/gi, (m) => {
    notices.push(m.replace(/<\/?system[^>]*>/gi, '').trim())
    return ''
  })
  return {
    content: content.replace(/\n{3,}/g, '\n\n').trim(),
    notice: notices.filter(Boolean).join('\n\n'),
  }
}

function localizeUserVisibleMessage(raw: string): string {
  if (!raw) return ''
  let text = raw
  text = text.replace(/Current time:\s*([^\n]+)/gi, (_m, value) => `当前时间：${translateTimeLine(String(value))}`)
  text = text.replace(/Reference UTC:\s*([^\n]+)/gi, (_m, value) => `UTC 参考时间：${String(value).trim()}`)
  text = text.replace(/If you do not send directly, your final plain-text reply will be delivered automatically\./gi, '如果你不直接发送，最终纯文本回复会自动送达。')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function localizeAgentMessage(raw: string): string {
  if (!raw) return ''
  let text = raw

  text = text.replace(/^\[message_id:\s*[^\]]+\]\s*/gim, '')
  text = text.replace(/^\[cron:([^\]\s]+)(?:\s+([^\]]+))?\]\s*/gim, (_m, _id, title) => {
    const name = String(title || '').trim()
    return name ? `定时任务「${name}」触发：\n` : '定时任务触发：\n'
  })
  text = text.replace(/^\[[a-z_]+:[^\]]+\]\s*/gim, '')
  text = text.replace(/\[message_id:\s*[^\]]+\]\s*/gi, '')
  text = text.replace(/\[cron:[^\]\s]+(?:\s+([^\]]+))?\]\s*/gi, (_m, title) => {
    const name = String(title || '').trim()
    return name ? `定时任务「${name}」触发：` : '定时任务触发：'
  })
  text = text.replace(/\b(?:ou|oc|on|open|user|chat)_[A-Za-z0-9_-]{12,}:\s*/gi, '')

  text = text.replace(
    /Current time:\s*([^\n]+)/gi,
    (_m, value) => `当前时间：${translateTimeLine(String(value))}`
  )
  text = text.replace(
    /Reference UTC:\s*([^\n]+)/gi,
    (_m, value) => `UTC 参考时间：${String(value).trim()}`
  )

  const replacements: Array<[RegExp, string]> = [
    [/Use the message tool if you need to notify the user directly for the current chat\./gi, '如果需要直接通知当前会话里的用户，请使用消息工具'],
    [/If you do not send directly, your final plain-text reply will be delivered automatically\./gi, '如果你不直接发送，最终纯文本回复会自动送达'],
    [/You are ChatGPT, a large language model trained by OpenAI\./gi, '你是 ChatGPT，一个由 OpenAI 训练的大语言模型'],
    [/The user is in an estimated location of\s*/gi, '用户的大致位置：'],
    [/The current date is\s*/gi, '当前日期：'],
    [/Any dates before this are in the past, and any dates after this are in the future\./gi, '早于该日期的是过去时间，晚于该日期的是未来时间'],
    [/When dealing with modern entities\/companies\/people/gi, '涉及现代实体、公司或人物时'],
    [/you MUST carefully confirm/gi, '必须仔细确认'],
    [/You are Codex, a coding agent based on GPT-5\./gi, '你是 Codex，一个基于 GPT-5 的编程 Agent'],
    [/You and the user share one workspace/gi, '你和用户共享同一个工作区'],
    [/Your job is to collaborate with them until their goal is genuinely handled\./gi, '你的任务是和用户协作，直到目标被真正处理好'],
    [/Do not send directly/gi, '不要直接发送'],
    [/plain-text reply/gi, '纯文本回复'],
    [/automatically/gi, '自动'],
    [/Knowledge cutoff:\s*/gi, '知识截止时间：'],
    [/Today's date:\s*/gi, '今天日期：'],
    [/Current date:\s*/gi, '当前日期：'],
    [/Current session/gi, '当前会话'],
    [/Created at/gi, '创建时间'],
    [/Last active/gi, '最后活跃'],
    [/Runtime/gi, '运行时长'],
    [/Used Tokens/gi, '已用 Token'],
    [/Context limit/gi, '上下文上限'],
    [/Usage rate/gi, '使用率'],
    [/System message/gi, '系统消息'],
    [/Developer message/gi, '开发者消息'],
    [/User message/gi, '用户消息'],
    [/Assistant message/gi, 'Agent 回复'],
    [/Tool call/gi, '工具调用'],
    [/Tool result/gi, '工具结果'],
    [/Final answer/gi, '最终回复'],
  ]
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement)
  }

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function translateTimeLine(value: string): string {
  const dayMap: Record<string, string> = {
    Sunday: '周日',
    Monday: '周一',
    Tuesday: '周二',
    Wednesday: '周三',
    Thursday: '周四',
    Friday: '周五',
    Saturday: '周六',
  }
  const monthMap: Record<string, string> = {
    January: '1月',
    February: '2月',
    March: '3月',
    April: '4月',
    May: '5月',
    June: '6月',
    July: '7月',
    August: '8月',
    September: '9月',
    October: '10月',
    November: '11月',
    December: '12月',
  }
  let line = value.trim()
  for (const [en, zh] of Object.entries(dayMap)) line = line.replace(new RegExp(`\\b${en}\\b`, 'g'), zh)
  for (const [en, zh] of Object.entries(monthMap)) line = line.replace(new RegExp(`\\b${en}\\b`, 'g'), zh)
  line = line.replace(/(\d+)(st|nd|rd|th)\b/gi, '$1日')
  line = line.replace(/\bAM\b/g, '上午').replace(/\bPM\b/g, '下午')
  return line
}

// Configure marked with highlight.js for code syntax highlighting
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  })
)

function renderMarkdown(content: string): string {
  if (!content) return ''
  return renderSafeMarkdown(content, source => marked.parse(source, { async: false, breaks: true }) as string)
}

/**
 * 将 content 字段按类型拆分为独立片段
 * 返回 [{ contentType, content }, ...]
 * 与 agent.ts 中 checkNewMessages()->extractContent() 逻辑保持一致
 */
function splitContentParts(content: unknown): { contentType: string; content: string; isError?: boolean }[] {
  // 1. 字符串：整体作为一个 text 片段
  if (typeof content === 'string') {
    return [{ contentType: 'text', content }]
  }

  // 2. 对象数组：每个 item 是一个独立片段
  if (Array.isArray(content)) {
    const parts = content.map((item: Record<string, unknown>) => {
      if (!item || typeof item !== 'object') return null
      const type = String(item.type ?? '')

      if (type === 'text') {
        const text = String(item.text ?? item.content ?? '')
        return text ? { contentType: 'text', content: text } : null
      }
      if (type === 'thinking') {
        const thinking = String(item.thinking ?? '')
        return thinking ? { contentType: 'thinking', content: thinking } : null
      }
      // 支持 toolUse 和 toolCall 两种命名（不同 API 可能使用不同字段名）
      if (type === 'toolUse' || type === 'toolCall') {
        const name = String(item.name ?? '')
        const input = item.input ?? item.arguments ?? item.parameters
        let displayContent = ''
        if (name) {
          displayContent = `**工具调用：${name}**`
        } else {
          displayContent = '**工具调用**'
        }
        // 显示参数
        if (typeof input === 'object' && input !== null) {
          displayContent += '\n\n```json\n' + JSON.stringify(input, null, 2) + '\n```'
        } else if (typeof input === 'string' && input) {
          // 尝试解析为 JSON，失败则直接显示
          try {
            const parsed = JSON.parse(input)
            displayContent += '\n\n```json\n' + JSON.stringify(parsed, null, 2) + '\n```'
          } catch {
            displayContent += `\n\n\`\`\`\n${input.slice(0, 500)}\n\`\`\``
          }
        }
        return displayContent ? { contentType: 'toolUse', content: displayContent } : null
      }
      if (type === 'toolResult') {
        const name = String(item.name ?? '')
        const isError = item.is_error === true
        // toolResult 的 content 可能是数组 [{type:'text', text:'...'}] 或纯字符串
        const resultContent = item.content
        let text = ''
        if (isError) {
          // 优先从 error 字段获取错误信息
          if (typeof item.error === 'string' && item.error) text = item.error
          else if (typeof resultContent === 'string' && resultContent) text = resultContent
          else if (Array.isArray(resultContent)) {
            const textParts = resultContent
              .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
              .map((r: any) => r.text)
            if (textParts.length > 0) text = textParts.join('\n')
          }
        }
        if (!text && Array.isArray(resultContent)) {
          const textParts = resultContent
            .filter((r: any) => r?.type === 'text' && typeof r.text === 'string')
            .map((r: any) => r.text)
          if (textParts.length > 0) text = textParts.join('\n').slice(0, 500)
        }
        if (!text && typeof item.text === 'string' && item.text) text = item.text
        if (!text && name) text = '[无返回内容]'
        if (!text) text = '[工具结果]'

        // 构建显示内容，包含工具名称
        let displayContent = ''
        if (name) displayContent += `**${name}**\n`
        displayContent += text
        return { contentType: 'toolResult', content: displayContent, isError }
      }
      // OpenAI 风格的图片：{ type: 'image_url', image_url: { url } }
      if (type === 'image_url') {
        const url = String((item.image_url as Record<string, unknown>)?.url ?? '')
        if (url) return { contentType: 'image', content: `![](${url})` }
        return null
      }
      // OpenResponses 风格的图片/文件（发送时使用，历史消息也可能以此格式返回）
      if (type === 'input_image') {
        const source = item.source as Record<string, unknown> | undefined
        const data = String(source?.data ?? '')
        const mediaType = String(source?.media_type ?? 'image/png')
        if (data) return { contentType: 'image', content: `![](data:${mediaType};base64,${data})` }
        // 也可能是 URL 来源
        const srcUrl = String(source?.url ?? '')
        if (srcUrl) return { contentType: 'image', content: `![](${srcUrl})` }
        return null
      }
      if (type === 'input_file') {
        const source = item.source as Record<string, unknown> | undefined
        const filename = String(source?.filename ?? '附件')
        const data = String(source?.data ?? '')
        if (data || source?.url) return { contentType: 'file', content: `[附件] ${filename}` }
        return null
      }
      return null
    }).filter(s => s !== null)
    return parts as { contentType: string; content: string }[]
  }

  // 3. 单个对象：提取 text 或 content 字段
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    return [{ contentType: 'text', content: String(obj.text ?? obj.content ?? '') }]
  }

  // 4. 其他情况转为字符串
  return [{ contentType: 'text', content: String(content ?? '') }]
}

function firstStringValue(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function normalizeTimestamp(raw: Record<string, unknown>, item: Record<string, unknown>): string | null {
  const direct = firstStringValue(item, ['timestamp', 'createdAt', 'created_at', 'time', 'date'])
    || firstStringValue(raw, ['timestamp', 'createdAt', 'created_at', 'time', 'date'])
  if (!direct) return null
  const n = Number(direct)
  if (Number.isFinite(n) && n > 0) return new Date(n > 1e12 ? n : n * 1000).toISOString()
  const parsed = Date.parse(direct)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : direct
}

function normalizeMessageModel(raw: Record<string, unknown>, item: Record<string, unknown>): string {
  return firstStringValue(item, ['model', 'modelName', 'providerModel'])
    || firstStringValue(raw, ['model', 'modelName', 'providerModel'])
    || agent.value?.model
    || ''
}

function inferTriggerInfo(content: string, role: string, model: string): Pick<MessageItem, 'triggerType' | 'triggerName'> {
  if (role !== 'user') return {}
  const cron = content.match(/\[cron:[^\]\s]+(?:\s+([^\]]+))?\]/i)
  if (cron) return { triggerType: 'cron', triggerName: String(cron[1] || '').trim() }
  if (/定时任务/.test(content)) return { triggerType: 'cron' }
  if (/\bmodel\b|模型触发/i.test(content)) return { triggerType: 'model', triggerName: model ? modelDisplayName(model) : '' }
  return { triggerType: 'user' }
}

/** 判断滚动条是否在底部附近 */
function isScrolledToBottom(): boolean {
  const el = msgContainerRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function loadHistory(silent: boolean = false, scrollToEnd: boolean = true): Promise<void> {
  if (!agent.value?.key) return
  const startedAt = Date.now()
  const MIN_LOADING_MS = 500
  if (!silent) loadingHistory.value = true
  try {
    // 优先：聚合该 agent 全部历史 session 文件（跨 session 看全部聊天记录）
    let history: Record<string, unknown>[] = []
    historyTruncated.value = false
    historyTotal.value = 0
    try {
      const full = await store.fetchAgentFullHistory(agent.value.key, 1500)
      if (full.messages.length > 0) {
        history = full.messages
        historyTruncated.value = full.truncated
        historyTotal.value = full.total
      }
    } catch (_) { /* 回退到单 session */ }
    // 回退：聚合接口无数据时，用旧的单 session 接口
    if (history.length === 0) {
      history = await store.fetchSessionHistory(agent.value.key)
    }
    historyCount.value = history.length

    const normalized = (history as Record<string, unknown>[]).flatMap((raw) => {

      const item = (raw && typeof raw === 'object' && raw.message && typeof raw.message === 'object'
        ? (raw.message as Record<string, unknown>)
        : raw) as Record<string, unknown>
      const role = String(item.role ?? '').toLowerCase()
      const parts = splitContentParts(item.content)
      const timestamp = normalizeTimestamp(raw, item)
      const model = normalizeMessageModel(raw, item)

      return parts.map((part) => {

        let content = part.content
        if (role === 'assistant') {
          content = cleanContent(content)
        }
        if (role === 'user') {
          content = cleanUserContent(content)
        }

        if(role === 'toolresult'){
          part.contentType = 'toolResult'
        }

        const bubbleRole = part.contentType === 'thinking' ? 'thinking'
          : (part.contentType === 'toolUse' || part.contentType === 'toolResult') ? 'tool'
            : (['user', 'assistant', 'system'].includes(role) ? role : 'assistant')

        const split = stripInlineSystemNotice(content)
        content = split.content || content
        const trigger = inferTriggerInfo(part.content, bubbleRole, model)

        return {
          role: bubbleRole,
          contentType: part.contentType,
          content,
          senderName: bubbleRole === 'user' ? userDisplayName.value : undefined,
          isError: part.isError,
          timestamp,
          model,
          systemNotice: split.notice,
          ...trigger,
        }
      })
    })

    const cleanMessages = normalized.filter((msg) => msg.content.length > 0)
    recentMessages.value = cleanMessages
  } finally {
    if (!silent) {
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed)
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining))
      }
      loadingHistory.value = false
    }
  }
  if (scrollToEnd) {
    await nextTick()
    scrollToBottom()
  }
}

/** 处理粘贴事件：捕获剪贴板中的图片 */
function handlePaste(event: ClipboardEvent): void {
  const items = event.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        // result 格式: "data:image/png;base64,xxxx"
        const parts = result.split(',')
        if (parts.length !== 2) return
        const mediaType = parts[0].replace('data:', '').replace(';base64', '')
        imageAttachments.value.push({
          url: result,
          mediaType,
          data: parts[1],
        })
      }
      reader.readAsDataURL(file)
      break // 只处理第一张图片
    }
  }
}

/** 输入框按键处理：Enter 发送，Ctrl+Enter 换行，@ Mention 键盘导航 */
function handleInputKeydown(e: KeyboardEvent): void {
  // @ Mention 下拉（Mention Dropdown）键盘导航
  if (mentionVisible.value && mentionFiltered.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mentionIndex.value = (mentionIndex.value + 1) % mentionFiltered.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mentionIndex.value = (mentionIndex.value - 1 + mentionFiltered.value.length) % mentionFiltered.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectMention(mentionFiltered.value[mentionIndex.value])
      return
    }
    if (e.key === 'Escape') {
      mentionVisible.value = false
      return
    }
  }

  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
  // Ctrl+Enter / Shift+Enter → 默认行为（插入换行）
}

/** 发送消息到当前会话 */
async function sendMessage(): Promise<void> {
  const text = chatInput.value.trim()
  if ((!text && imageAttachments.value.length === 0) || !agent.value?.key || sending.value) return

  // ── 认知引擎预处理（仅纯文字消息）────────────────────────────────────────
  if (text && imageAttachments.value.length === 0) {
    try {
      const r = await fetch(`/api/cognitive/analyze?text=${encodeURIComponent(text)}`)
      const d = await r.json()
      if (d.ok && d.intent?.directResponse) {
        // 简单问候/时间/感谢 → 本地直接回复，不消耗 Gateway token
        ElNotification({
          title: `${agent.value.name || '助手'} 回复`,
          message: d.intent.directResponse,
          type: 'success',
          duration: 6000,
          position: 'bottom-right',
        })
        chatInput.value = ''
        sentimentInfo.value = null
        return
      }
      // 有情绪上下文 → 追加到文本前（提示 Agent 用合适语气回复）
      if (d.ok && d.moodContext) {
        chatInput.value = `${d.moodContext}\n${text}`
      }
    } catch { /* 认知分析失败时直接走正常流程 */ }
  }
  // ────────────────────────────────────────────────────────────────────────

  sending.value = true
  try {
    // 方案B：有图片时先写入 Agent workspace，再发送文件路径
    if (imageAttachments.value.length > 0) {
      await store.sendAgentMessageWithImages(agent.value.key, text, imageAttachments.value)
    } else {
      await store.sendAgentMessage(agent.value.key, chatInput.value.trim() || text)
    }

    chatInput.value = ''
    imageAttachments.value = []
    sentimentInfo.value = null

    ElMessage.success('消息已发送')

    // 发送成功后静默刷新消息列表（不显示 loading 遮罩）
    await loadHistory(true)
  } catch (e: any) {
    console.error('[AgentDetailDrawer] message send failed')
    const errorMsg = e?.message || String(e)

    if (errorMsg.includes('missing scope: operator.write')) {
      ElMessage.warning({
        message: '权限不足：需要 operator.write 权限。请在 Gateway 配置中设置 gateway.controlUi.dangerouslyDisableDeviceAuth: true 并重启 Gateway，或使用 openclaw devices approve --latest 批准设备。',
        duration: 6000,
      })
    } else if (errorMsg.includes('timeout')) {
      ElMessage.error('发送超时，请检查 Gateway 是否运行正常')
    } else {
      ElMessage.error(`发送失败: ${e.message}`)
    }
  } finally {
    sending.value = false
  }
}

async function refreshStatus(): Promise<void> {
  if (!agent.value?.key) return
  resetting.value = true
  try {
    await store.fetchAgentStatus(agent.value.key)
  } finally {
    setTimeout(() => { resetting.value = false }, 500)
  }
}

async function handleResetSession(): Promise<void> {
  if (!agent.value?.key) return

  const agentId = agent.value.key.split(':').length >= 2 ? agent.value.key.split(':')[1] : agent.value.key
  try {
    await ElMessageBox.confirm(
      `确定要重置 "${displayAgentName.value}" 的会话吗？这将执行命令：openclaw agent --agent ${agentId} --message "/reset"`,
      '重置会话',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    resetting.value = true
    await store.resetSession(agent.value.key)
    ElMessage.success('已执行重置命令')

    // 刷新状态
    await refreshStatus()
  } catch (e: any) {
    if (e !== 'cancel') {
      const errorMsg = e?.message || String(e)
      const errorCode = e?.code
      let userMessage = '重置会话失败'
      let configSteps: string[] = []

      // 1. 前置检测抛出的结构化错误
      if (e instanceof ToolRestrictedError || errorCode === 'TOOLS_RESTRICTED') {
        const toolName = e?.tool || 'sessions_send'
        userMessage = `${toolName} 工具不可用\n\nGateway 安全策略 (gateway.tools) 默认为 deny-allowlist 模式，\n未将 ${toolName} 加入允许列表。`
        configSteps = e?.steps || [
          '1. 编辑 Gateway 配置文件 (openclaw.yaml)',
          '2. 添加 gateway.tools.allow 配置',
          '3. 重启 Gateway',
        ]
      }
      // 2. 权限不足：operator.write scope
      else if (errorMsg.includes('missing scope: operator.write')) {
        userMessage = '权限不足：需要 operator.write 权限。请在 Gateway 配置中设置 gateway.controlUi.dangerouslyDisableDeviceAuth: true 并重启 Gateway，或者使用 openclaw devices approve --latest 批准设备配对请求。'
      }
      // 3. 工具被拒绝（广义关键词匹配）
      else if (/tool.*(not\s+)?available|sessions_send.*(denied|rejected|forbidden)|invoke.*(denied|rejected)|tools.*restrict|403|denied|forbidden/i.test(errorMsg)) {
        userMessage = `sessions_send 工具不可用\n\nGateway 安全策略拒绝了该工具调用。`
        configSteps = [
          '1. 编辑 Gateway 配置文件 (openclaw.yaml / .openclaw.yaml)',
          '2. 添加以下配置：',
          '   gateway:',
          '     tools:',
          '       allow:',
          '         - sessions_send',
          '3. 重启 Gateway：openclaw gateway restart',
          '4. 配置文件路径：OpenClaw 安装目录下的 openclaw.yaml',
        ]
      }

      // 如果有配置步骤，用弹窗展示更详细的信息
      if (configSteps.length > 0) {
        await ElMessageBox.alert(
          `${userMessage}\n\n解决方法：\n${configSteps.join('\n')}`,
          '重置失败',
          {
            confirmButtonText: '我知道了',
            type: 'warning',
          }
        ).catch(() => { }) // 忽略关闭弹窗
      } else {
        ElMessage.error(userMessage.replace(/\n/g, ' '))
      }

      console.error('[AgentDetailDrawer] session reset failed')
    }
  } finally {
    resetting.value = false
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null

function clearDrawerHistoryTimer() {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

function scheduleDrawerHistoryRefresh() {
  clearDrawerHistoryTimer()
  if (!drawerVisible.value || !agent.value) return
  refreshTimer = setTimeout(async () => {
    if (drawerVisible.value && agent.value) {
      const wasAtBottom = isScrolledToBottom()
      await loadHistory(true, wasAtBottom) // 静默刷新，仅在用户已在底部时保持底部
    }
    scheduleDrawerHistoryRefresh()
  }, document.hidden ? BACKGROUND_DRAWER_INTERVAL : DRAWER_HISTORY_INTERVAL)
}

function handleDrawerVisibilityChange() {
  if (agent.value?.status === 'running') {
    if (!document.hidden) fetchDrawerLiveActivity()
    scheduleDrawerLivePoll()
  }
  if (drawerVisible.value && agent.value) {
    if (!document.hidden) {
      const wasAtBottom = isScrolledToBottom()
      loadHistory(true, wasAtBottom)
    }
    scheduleDrawerHistoryRefresh()
  }
}

// Watch for drawer open
watch(drawerVisible, (val) => {
  if (val && agent.value) {
    loadQuickTemplates()
    // Load history on open - 首次打开强制滚动到底部
    loadHistory(false, true)
    // 加载技能数据 + 定时任务
    fetchDrawerSkills()
    fetchAgentCrons()
    // 抽屉打开期间定时刷新消息
    scheduleDrawerHistoryRefresh()
    // 双击进会话时聚焦输入框
    if (props.autoFocusInput) {
      nextTick(() => {
        setTimeout(() => {
          const el = chatInputRef.value?.textarea || chatInputRef.value?.input
          if (el && typeof el.focus === 'function') el.focus()
        }, 250)
      })
    }
  } else if (!val) {
    // 关闭抽屉时停止刷新，收起技能面板
    voiceCall.endCall()
    clearDrawerHistoryTimer()
    showSkillsPanel.value = false
    showCronPanel.value = false
  }
})

watch(() => agent.value?.key, () => {
  voiceCall.endCall()
})

onMounted(() => {
  loadQuickTemplates()
  document.addEventListener('visibilitychange', handleDrawerVisibilityChange)
  window.addEventListener('quick-message-config-updated', onQuickMessageConfigUpdated)
  window.addEventListener('resize', updateViewportWidth)
})

onUnmounted(() => {
  stopDrawerLivePoll()
  clearDrawerHistoryTimer()
  document.removeEventListener('visibilitychange', handleDrawerVisibilityChange)
  window.removeEventListener('quick-message-config-updated', onQuickMessageConfigUpdated)
  window.removeEventListener('resize', updateViewportWidth)
})

/** 滚动到最后一条消息 */
function scrollToBottom(): void {
  const container = msgContainerRef.value
  if (!container) return
  const lastRow = container.querySelector('.chat-row:last-child') as HTMLElement | null
  if (lastRow) {
    lastRow.scrollIntoView({ block: 'end', behavior: 'instant' })
  } else {
    container.scrollTop = container.scrollHeight
  }
}

// 新消息到达时仅在已处于底部的情况下自动滚动到底部
watch(recentMessages, () => {
  if (isScrolledToBottom()) {
    nextTick(() => scrollToBottom())
  }
}, { deep: false })
</script>

<style scoped>
.drawer-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
}

/* ── Drawer 头像（头部标题左侧的圆头像，复用 AgentCard 的样式风格）── */
.drawer-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.drawer-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
}
.title-text {
  font-weight: 600;
  font-size: 16px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-badge {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ==================== 左右布局 ==================== */
.drawer-body {
  display: flex;
  gap: 16px;
  height: 100%;
  overflow: hidden;
}

.drawer-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  /* 让加载遮罩可以 absolute 覆盖 */
}

/* ── 左面板滚动容器 (Card + 发送栏 整体布局) ── */
.left-scroll-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── el-card body 内的消息滚动容器 ── */
.msg-scroll-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scroll-behavior: smooth;
}

/* ── 消息 Card：纯视觉容器，不管 overflow ── */
.drawer-left .msg-section {
  flex: 1;
}

.drawer-left .msg-section :deep(.el-card) {
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.drawer-left .msg-section :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

/* ── Card body 内： loading/empty/messages ── */
.msg-card-inner {
  min-height: 0;
}

.history-hint {
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 6px 8px;
  margin-bottom: 4px;
  opacity: 0.85;
}

/* ── 历史总结弹窗 ── */
.ds-toolbar { display: flex; align-items: center; gap: 10px; padding: 0 2px 12px; border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 8px; }
.ds-range { font-size: 13px; color: var(--el-text-color-secondary); }
.ds-stat { margin-left: auto; font-size: 12px; color: var(--el-text-color-secondary); }
.ds-loading, .ds-empty { text-align: center; padding: 40px 0; color: var(--el-text-color-secondary); font-size: 14px; }
.ds-days { display: flex; flex-direction: column; gap: 18px; padding-right: 6px; }
.ds-day-head { display: flex; align-items: baseline; gap: 12px; padding: 4px 0 8px; position: sticky; top: 0; background: var(--el-bg-color); z-index: 1; }
.ds-day-date { font-size: 15px; font-weight: 700; color: var(--el-text-color-primary); }
.ds-day-meta { font-size: 12px; color: var(--el-text-color-secondary); }
.ds-sessions { display: flex; flex-direction: column; gap: 10px; }
.ds-ai {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0 10px;
  padding: 10px 12px;
  background: var(--accent-glow);
  border-left: 2px solid var(--accent);
  border-radius: 0 8px 8px 0;
}
.ds-ai-tag { font-size: 11px; font-weight: 600; color: var(--accent); }
.ds-ai-text { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-primary); }
.ds-ai-loading { font-size: 12px; color: var(--text-secondary); }
.ds-ai-err { font-size: 12px; color: var(--danger); }
.ds-session { border-left: 3px solid var(--el-border-color); padding: 6px 0 6px 12px; }
.ds-session-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.ds-time { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--el-text-color-primary); font-size: 13px; }
.ds-trigger { font-size: 11px; padding: 1px 7px; border-radius: 10px; flex-shrink: 0; }
.ds-trigger.cron { background: rgba(191, 90, 242,0.15); color: #bf5af2; }
.ds-trigger.user { background: rgba(94, 92, 230,0.15); color: #5e5ce6; }
.ds-task { font-size: 13px; color: var(--el-text-color-primary); font-weight: 500; }
.ds-did, .ds-result { font-size: 12.5px; color: var(--el-text-color-regular); line-height: 1.5; padding-left: 2px; }
.ds-result { color: var(--el-text-color-secondary); }
.ds-label { display: inline-block; min-width: 34px; color: var(--el-text-color-secondary); font-weight: 600; margin-right: 6px; }

.msg-card-inner.empty-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* ── 消息气泡列表容器 ── */
.messages-list-outer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawer-right {
  width: 340px;
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 底部操作栏：不参与滚动，固定在右侧面板底部 */
.action-bar--sticky {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 12px 0 0;
  border-top: 1px solid var(--border-color);
  flex-wrap: wrap;
}
.action-bar--sticky .el-button {
  flex: 1;
  min-width: 68px;
  height: 34px;
  margin-left: 0 !important;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-weight: 700;
  line-height: 1;
}

.action-bar--sticky .el-button :deep(.el-icon) {
  margin-right: 0;
  font-size: 14px;
  flex-shrink: 0;
}

.action-bar--sticky .reset-session-btn {
  flex-basis: 92px;
  border-color: rgba(255, 105, 97, 0.42) !important;
  background: rgba(255, 69, 58, 0.17) !important;
  color: #ffd2cc !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 6px 18px rgba(255, 69, 58, 0.08);
}

.action-bar--sticky .reset-session-btn:hover {
  border-color: rgba(255, 105, 97, 0.62) !important;
  background: rgba(255, 69, 58, 0.24) !important;
  color: #fff0ed !important;
}

.action-bar--sticky .session-history-btn,
.action-bar--sticky .session-summary-btn {
  border-color: rgba(142, 142, 147, 0.28) !important;
  background: rgba(255, 255, 255, 0.045) !important;
  color: rgba(245, 245, 247, 0.88) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.action-bar--sticky .session-history-btn:hover,
.action-bar--sticky .session-summary-btn:hover {
  border-color: rgba(10, 132, 255, 0.36) !important;
  background: rgba(10, 132, 255, 0.12) !important;
  color: #d8ecff !important;
}

:global(html.light-theme .action-bar--sticky .reset-session-btn) {
  border-color: rgba(255, 59, 48, 0.22) !important;
  background: rgba(255, 59, 48, 0.08) !important;
  color: #b42318 !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.72), 0 8px 18px rgba(255, 59, 48, 0.07);
}

:global(html.light-theme .action-bar--sticky .reset-session-btn:hover) {
  border-color: rgba(255, 59, 48, 0.34) !important;
  background: rgba(255, 59, 48, 0.12) !important;
}

:global(html.light-theme .action-bar--sticky .session-history-btn),
:global(html.light-theme .action-bar--sticky .session-summary-btn) {
  border-color: rgba(0, 122, 255, 0.18) !important;
  background: rgba(248, 251, 255, 0.96) !important;
  color: #1d4ed8 !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.86), 0 8px 18px rgba(31, 35, 42, 0.045);
}

:global(html.light-theme .action-bar--sticky .session-history-btn:hover),
:global(html.light-theme .action-bar--sticky .session-summary-btn:hover) {
  border-color: rgba(0, 122, 255, 0.24) !important;
  background: rgba(0, 122, 255, 0.075) !important;
  color: #0066cc !important;
}

:global(html.light-theme .action-bar--sticky .el-button.is-disabled),
:global(html.light-theme .action-bar--sticky .el-button.is-disabled:hover),
:global(html.light-theme .action-bar--sticky .el-button.is-disabled:focus) {
  opacity: 1 !important;
  border-color: rgba(0, 122, 255, 0.16) !important;
  background: rgba(239, 246, 255, 0.92) !important;
  color: #64748b !important;
}

:global(html.light-theme .action-bar--sticky .reset-session-btn.is-disabled),
:global(html.light-theme .action-bar--sticky .reset-session-btn.is-disabled:hover),
:global(html.light-theme .action-bar--sticky .reset-session-btn.is-disabled:focus) {
  border-color: rgba(255, 59, 48, 0.18) !important;
  background: rgba(255, 241, 240, 0.92) !important;
  color: #b91c1c !important;
}
.action-bar-spacer {
  flex: 0 0 100%;
  min-width: 4px;
  height: 0;
}

/* 快捷模板栏 */
.quick-tpl-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px 4px 4px 0;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}
.quick-tpl-label {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.quick-tpl-btn {
  font-size: 11px !important;
  color: var(--text-secondary) !important;
  padding: 2px 6px !important;
  height: auto !important;
  border-radius: 4px !important;
  transition: all 0.15s !important;
}
.quick-tpl-btn:hover {
  color: var(--accent) !important;
  background: rgba(10, 132, 255,0.08) !important;
}

/* el-scrollbar 占满 .drawer-right 的全部高度 */
.drawer-right :deep(.drawer-right-scroll),
.drawer-right :deep(.el-scrollbar) {
  flex: 1;
  height: 100%;
}
/* 视图区是 flex 列，让所有卡片像之前一样竖排 */
.drawer-right :deep(.drawer-right-scroll-view) {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 4px;
}

/* 强制右侧面板内所有 el-card 及其子元素不产生纵向内部滚动 */
.drawer-right :deep(.el-card),
.drawer-right :deep(.el-card__header),
.drawer-right :deep(.el-card__body) {
  overflow-y: visible !important;
  max-height: none !important;
}

.detail-section {
  background: var(--glass-card-bg, var(--bg-card));
  border: 1px solid var(--glass-card-border, var(--border-color));
  box-shadow: var(--glass-inner-highlight, none), 0 10px 28px rgba(0, 0, 0, 0.12);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.section-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.msg-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: normal;
}

.msg-count-inline {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
  font-weight: 400;
}

.message-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.info-grid {
  display: grid;
  gap: 10px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.info-item:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-secondary);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.info-value {
  color: var(--text-primary);
  font-size: 13px;
  text-align: right;
  max-width: 65%;
  word-break: break-all;
}

.monospace {
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
}

/* Token usage panel */
.token-usage-panel {
  padding: 4px 0;
}

.token-stat-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 16px;
}

.token-stat {
  text-align: center;
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 2px;
}

.token-progress {
  margin-top: 8px;
}
.token-progress--inactive :deep(.el-progress-bar__inner) {
  background: var(--fill-subtle);
}
.token-no-data {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
  opacity: 0.6;
}

/* 聊天气泡样式（由 .messages-list-outer 承载） */

.chat-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 6px;
}

.chat-row-user {
  align-items: flex-end;
}

.chat-row-assistant {
  align-items: flex-start;
}

.chat-stack {
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-stack-user {
  align-items: flex-end;
}

.chat-stack-assistant {
  align-items: flex-start;
}

.chat-speaker {
  padding: 0 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.chat-time-divider {
  align-self: center;
  margin: 6px 0 4px;
  padding: 3px 10px;
  border-radius: 999px;
  color: rgba(235, 235, 245, 0.58);
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(235, 235, 245, 0.08);
  font-size: 11px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.chat-meta {
  max-width: 100%;
  padding: 0 4px;
  color: rgba(235, 235, 245, 0.46);
  font-size: 10.5px;
  line-height: 1.35;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.16s ease, transform 0.16s ease;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-stack:hover .chat-meta {
  opacity: 1;
  transform: translateY(0);
}

.chat-bubble {
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  position: relative;
}

.system-notice-fold {
  margin-top: 8px;
  border-top: 1px solid rgba(235, 235, 245, 0.12);
  padding-top: 7px;
}

.system-notice-fold summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  user-select: none;
  border-radius: 999px;
  padding: 3px 9px;
  color: rgba(179, 215, 255, 0.92);
  background: rgba(10, 132, 255, 0.12);
  border: 1px solid rgba(10, 132, 255, 0.18);
  font-size: 11px;
  font-weight: 700;
}

.system-notice-text {
  margin-top: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  color: rgba(235, 235, 245, 0.72);
  background: rgba(0, 0, 0, 0.16);
  border: 1px solid rgba(235, 235, 245, 0.08);
  font-size: 12px;
}

/* 用户消息：蓝色气泡，右对齐 */
.bubble-user {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.02)),
    rgba(10, 132, 255, 0.88);
  color: #fff;
  border-bottom-right-radius: 4px;
  box-shadow: 0 8px 20px rgba(10, 132, 255, 0.16);
}

/* AI 回复：灰色气泡，左对齐 */
.bubble-assistant {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02)),
    var(--bubble-assistant-bg);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  border: 1px solid rgba(235, 235, 245, 0.08);
}

/* 思考过程：黄色左边框，半透明背景 */
.bubble-thinking {
  background: rgba(255, 159, 10, 0.075);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  border-left: 3px solid #ffd60a;
  font-style: italic;
}

.bubble-thinking .markdown-body {
  opacity: 0.8;
}

/* 工具调用 / 工具结果：浅灰蓝色背景 + 左边框 */
.bubble-tool {
  background: rgba(10, 132, 255, 0.095);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  border: 1px solid rgba(10, 132, 255, 0.2);
  border-left: 3px solid #0a84ff;
  font-size: 12.5px;
}

/* 工具错误：红色左边框，半透明背景 */
.bubble-tool-error {
  background: rgba(255, 69, 58, 0.075);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  border-left: 3px solid #ff453a;
  font-size: 12.5px;
}

/* 图片/文件：绿色左边框 */
.bubble-media {
  background: rgba(48, 209, 88, 0.075);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  border-left: 3px solid #66bb6a;
}

/* 气泡内标签（思考/工具调用/工具结果） */
.bubble-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border-radius: 4px;
  opacity: 0.75;
  background: var(--fill-subtle);
}

/* 工具调用/结果标签更明显的背景 */
.bubble-tool .bubble-label {
  background: rgba(10, 132, 255, 0.2);
  color: var(--accent);
  opacity: 0.9;
}

.bubble-tool-error .bubble-label {
  background: rgba(255, 69, 58, 0.2);
  color: var(--danger);
  opacity: 0.9;
}

.bubble-thinking .bubble-label {
  background: rgba(255, 159, 10, 0.15);
  color: var(--warning);
  opacity: 0.85;
}



/* Text colors */
.text-success {
  color: var(--el-color-success);
}

.text-warning {
  color: var(--el-color-warning);
}

.text-danger {
  color: var(--el-color-danger);
}

/* Status colors */
.status-running {
  color: var(--el-color-warning);
}

.status-idle {
  color: var(--el-color-success);
}

.status-error {
  color: var(--el-color-danger);
}

.status-aborted {
  color: var(--el-color-info);
}

.status-unknown {
  color: var(--el-text-color-secondary);
}

/* Action bar */
.action-bar {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.action-bar .el-button {
  flex: 1;
}

/* 手动加载历史时左侧消息区域的 loading 遮罩 */
.left-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 14px;
  z-index: 10;
  border-radius: 8px;
}

.empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  padding: 16px;
  color: var(--text-secondary);
}

/* Raw details */
.raw-details {
  background: var(--bg-elevated);
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  margin: 0;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── 历史 Token 明细 ── */
.hist-token-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hist-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.hist-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.hist-value {
  font-size: 20px;
  font-weight: 700;
  color: #ff9f0a;
  font-variant-numeric: tabular-nums;
}

.model-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-breakdown-row {
  display: grid;
  grid-template-columns: 24px 1fr auto 80px 36px;
  align-items: center;
  gap: 8px;
}

.model-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 5px 14px rgba(0,0,0,0.18);
}

.model-logo--small {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  font-size: 9px;
}

.model-logo-img {
  width: 14px;
  height: 14px;
  display: block;
  object-fit: contain;
}

.model-logo--deepseek { background: linear-gradient(135deg, #5e5ce6, #4644b8); }
.model-logo--minimax { background: linear-gradient(135deg, #30d158, #1f9e43); }
.model-logo--openai { background: linear-gradient(135deg, #0a84ff, #0064d2); }
.model-logo--anthropic { background: linear-gradient(135deg, #ff9f0a, #d97e06); }
.model-logo--qwen { background: linear-gradient(135deg, #bf5af2, #8e44c9); }
.model-logo--google { background: linear-gradient(135deg, #0a84ff, #0064d2); }
.model-logo--local { background: linear-gradient(135deg, #30d158, #1f9e43); }
.model-logo--generic { background: linear-gradient(135deg, #bf5af2, #8e44c9); }

.model-label {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-tokens {
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  text-align: right;
}

.model-pct-bar {
  width: 80px;
}

.model-pct-text {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
}

/* ═══════════ 聊天发送区域 ═══════════ */
.chat-send-area {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
}

/* 输入框 + 发送按钮水平排列 */
/* ── 情绪徽章 ── */
.sentiment-badge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.sentiment-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid;
  font-weight: 500;
  white-space: nowrap;
}
.sentiment-hint {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.chat-send-area .send-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.chat-send-area .send-row .el-button {
  flex-shrink: 0;
  height: fit-content;
}

/* ── 图片预览条 ── */
.image-preview-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.image-preview-item {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.image-preview-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: pointer;
  transition: transform 0.15s, filter 0.15s;
}

.image-preview-thumb:hover {
  transform: scale(1.05);
  filter: brightness(1.1);
}

.image-preview-item .image-remove-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  min-width: 0;
  padding: 0;
  font-size: 14px;
  line-height: 20px;
  border-radius: 50%;
}

/* ════════ 实时活动卡片 ════════ */
.live-activity-card {
  border-color: rgba(48, 209, 88, 0.25) !important;
  background: rgba(48, 209, 88, 0.04) !important;
}

.live-header-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #30d158;
  margin-right: 6px;
  animation: drawerPulse 1.4s ease-in-out infinite;
}
@keyframes drawerPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.7); }
}
.live-header-time {
  font-size: 10px;
  color: #81c784;
  font-weight: 400;
  margin-left: auto;
}
.drawer-live-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.drawer-live-empty {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.drawer-live-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-color);
}
.drawer-live-row:last-child { border-bottom: none; }
.dlr-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dlr-icon { font-size: 13px; line-height: 1; }
.dlr-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}
.dlr-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(230,230,230,0.88);
  white-space: pre-wrap;
  word-break: break-word;
  padding-left: 20px;
}
/* 分类颜色 */
.dlr-thinking .dlr-badge  { color: #ffd667; }
.dlr-thinking .dlr-text   { color: rgba(255, 214, 102,0.65); font-style: italic; }
.dlr-tool .dlr-badge      { color: #6cb2ff; }
.dlr-tool .dlr-text       { color: #bbdefb; }
.dlr-toolResult .dlr-badge { color: #a5d6a7; }
.dlr-toolResult .dlr-text  { color: #c8e6c9; font-family: 'Cascadia Code', monospace; font-size: 11.5px; }
.dlr-text .dlr-badge      { color: #cf7ef5; }
.dlr-text .dlr-text       { color: #e5c0fa; }
.dlr-trigger .dlr-text    { color: rgba(200,200,200,0.6); font-size: 11.5px; }

.chat-speaker { display: inline-flex; align-items: center; gap: 6px; }
/* 用户消息（右对齐）：名字靠右、hover 出现的按钮在左，整体垂直居中 */
.chat-stack-user .chat-speaker { flex-direction: row-reverse; }
/* 用户(右对齐)消息：名字放最右(贴气泡边)，悬停才显示的按钮排在左侧 */
.chat-stack-user .chat-speaker { flex-direction: row-reverse; }
.chat-del-btn {
  opacity: 0;
  font-size: 10px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  transition: opacity 0.15s, color 0.15s;
}
.chat-row:hover .chat-del-btn { opacity: 0.7; }
.chat-del-btn:hover { opacity: 1; color: var(--danger); }
.chat-speak-btn {
  opacity: 0;
  font-size: 12px;
  color: var(--text-muted);
  background: none; border: none; cursor: pointer; padding: 0 2px;
  display: inline-flex; align-items: center;
  transition: opacity 0.15s, color 0.15s;
}
.chat-row:hover .chat-speak-btn { opacity: 0.7; }
.chat-speak-btn:hover { opacity: 1; color: var(--accent); }
.chat-speak-btn.playing { opacity: 1; color: var(--accent); animation: pulse 1.2s ease-in-out infinite; }

html.light-theme .chat-meta { color: rgba(60, 60, 67, 0.6); }
</style>

<!-- 非 scoped：v-html 渲染的 markdown 内容不受 scoped 限制 -->
<style>
.el-popper.agent-help-tooltip {
  z-index: 5200 !important;
  max-width: 320px;
  padding: 10px 12px !important;
  border-radius: 11px !important;
  font-size: 12.5px;
  line-height: 1.55;
  letter-spacing: 0;
  color: rgba(245, 245, 247, 0.94) !important;
  background: rgba(34, 34, 38, 0.92) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
}

.el-popper.agent-help-tooltip .el-popper__arrow::before {
  background: rgba(34, 34, 38, 0.92) !important;
  border-color: rgba(255, 255, 255, 0.16) !important;
}

html.light-theme .el-popper.agent-help-tooltip {
  color: rgba(29, 29, 31, 0.92) !important;
  background: rgba(255, 255, 255, 0.82) !important;
  border-color: rgba(60, 60, 67, 0.14) !important;
  box-shadow: 0 18px 46px rgba(31, 35, 42, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.88);
}

html.light-theme .el-popper.agent-help-tooltip .el-popper__arrow::before {
  background: rgba(255, 255, 255, 0.82) !important;
  border-color: rgba(60, 60, 67, 0.14) !important;
}

/* ── Markdown 内容样式（适配深色主题 & 两种气泡底色） ── */
.markdown-body {
  line-height: 1.65;
  font-size: 13px;
}

/* ── 段落 ── */
.markdown-body p {
  margin: 0 0 8px;
}

.markdown-body p:last-child {
  margin-bottom: 0;
}

/* ── 标题 ── */
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 10px 0 6px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
}

.markdown-body h1 {
  font-size: 17px;
}

.markdown-body h2 {
  font-size: 15.5px;
}

.markdown-body h3 {
  font-size: 14.5px;
}

.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  font-size: 13.5px;
}

/* ── 列表（标记在内部，缩进一致）── */
.markdown-body ul,
.markdown-body ol {
  margin: 6px 0;
  padding-left: 0;
  list-style-position: inside;
}

.markdown-body li {
  margin: 3px 0;
}

.markdown-body li>p {
  margin: 2px 0;
  display: inline;
}

/* 嵌套列表缩进 */
.markdown-body ul ul,
.markdown-body ul ol,
.markdown-body ol ul,
.markdown-body ol ol {
  padding-left: 20px;
}

/* ── 任务列表（[x] / [ ]）── */
.markdown-body ul.contains-task-list {
  padding-left: 6px;
  list-style: none;
}

.markdown-body .task-list-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.markdown-body .task-list-item input[type="checkbox"] {
  margin-top: 3px;
  accent-color: var(--accent, #0a84ff);
}

/* ── 代码块（pre） ── */
.markdown-body pre {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.55;
  background: var(--code-bg) !important;
  border: 1px solid var(--border-color);
}

.bubble-user .markdown-body pre {
  background: rgba(0, 0, 0, 0.35) !important;
  border-color: var(--text-muted);
}

/* ── inline code ── */
.markdown-body code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'JetBrains Mono', monospace;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--fill-hover);
}

.bubble-user .markdown-body code {
  background: rgba(0, 0, 0, 0.2);
}

/* ── pre 内的 code 恢复无样式 ── */
.markdown-body pre code {
  padding: 0;
  background: none !important;
  border-radius: 0;
  font-size: inherit;
  color: inherit;
}

/* ── highlight.js 在气泡内微调 ── */
.markdown-body .hljs {
  background: transparent !important;
  padding: 0;
}

/* ── 加粗 / 斜体 ── */
.markdown-body strong {
  font-weight: 700;
}

.markdown-body em {
  font-style: italic;
}

/* ── 链接 ── */
.markdown-body a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  opacity: 0.88;
  transition: opacity 0.15s;
}

.markdown-body a:hover {
  opacity: 1;
}

.bubble-user .markdown-body a {
  text-decoration-color: var(--text-secondary);
}

/* ── 引用 ── */
.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--accent, #0a84ff);
  opacity: 0.88;
  border-radius: 0 4px 4px 0;
  background: var(--fill-subtle);
}

.bubble-user .markdown-body blockquote {
  background: rgba(0, 0, 0, 0.1);
  border-left-color: var(--text-secondary);
}

.markdown-body blockquote p:last-child {
  margin-bottom: 0;
}

/* ── 水平线 ── */
.markdown-body hr {
  margin: 10px 0;
  border: none;
  height: 1px;
  background: var(--fill-hover);
}

/* ── 表格（清晰边框）── */
.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12.5px;
  width: 100%;
  display: block;
  overflow-x: auto;
}

.markdown-body th,
.markdown-body td {
  padding: 7px 12px;
  border: 1px solid var(--border-color);
  text-align: left;
}

.bubble-assistant .markdown-body th,
.bubble-assistant .markdown-body td {
  border-color: var(--text-muted);
}

.bubble-user .markdown-body th,
.bubble-user .markdown-body td {
  border-color: var(--text-muted);
}

.markdown-body th {
  font-weight: 650;
  background: var(--fill-subtle);
}

.bubble-user .markdown-body th {
  background: rgba(0, 0, 0, 0.15);
}

.markdown-body tr:nth-child(even) td {
  background: var(--fill-subtle);
}

.bubble-user .markdown-body tr:nth-child(even) td {
  background: rgba(0, 0, 0, 0.08);
}

/* ── 图片 ── */
.markdown-body img {
  max-width: 100%;
  border-radius: 6px;
  margin: 8px 0;
}

/* ══ 技能库快捷按钮（消息区 header 右侧） ══ */
.skills-shortcut-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 7px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  min-width: 64px;
  line-height: 1;
}
.skills-shortcut-btn:hover {
  border-color: var(--accent, #0a84ff);
  color: var(--accent, #0a84ff);
  background: rgba(10, 132, 255,0.08);
}
.skills-shortcut-btn--active {
  border-color: var(--accent, #0a84ff);
  color: var(--accent, #0a84ff);
  background: rgba(10, 132, 255,0.12);
}
.shortcut-icon {
  font-size: 18px !important;
}
.shortcut-bottom {
  display: flex;
  align-items: center;
  gap: 4px;
}
.shortcut-label {
  font-size: 11px;
}
.shortcut-count {
  font-size: 10px;
  background: var(--fill-hover);
  border-radius: 8px;
  padding: 0 5px;
  height: 14px;
  line-height: 14px;
}

/* ══ 内联技能面板（消息列表上方） ══ */
.skills-inline-panel {
  border-bottom: 1px solid var(--border-color);
  padding: 10px 12px;
  background: rgba(0,0,0,0.12);
  overflow: hidden;
}

/* 过渡动画 */
.skills-panel-enter-active,
.skills-panel-leave-active {
  transition: max-height 0.28s ease, opacity 0.2s ease, padding 0.25s ease;
  max-height: 480px;
}
.skills-panel-enter-from,
.skills-panel-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.skills-panel-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 0;
}

.skills-panel-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 6px 2px;
  opacity: 0.75;
}

/* 分组容器 */
.skills-panel-grouped {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 分类标题行 */
.sp-cat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 4px 5px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border-color);
  margin-top: 4px;
}
.sp-cat-header:first-child { margin-top: 0; }
.sp-cat-header:hover { background: var(--fill-subtle); border-radius: 4px; }
.sp-cat-icon { font-size: 13px; }
.sp-cat-name { font-size: 12px; font-weight: 700; color: var(--text-primary); flex: 1; }
.sp-cat-count {
  font-size: 10px; color: var(--text-secondary);
  background: var(--fill-subtle); border-radius: 8px;
  padding: 0 6px; height: 16px; line-height: 16px;
}
.sp-cat-chevron {
  font-size: 12px; color: var(--text-secondary);
  transition: transform 0.2s;
  display: inline-block;
}
.sp-cat-chevron.collapsed { transform: rotate(-90deg); }

/* 技能条目网格：两列 */
.skills-panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px 8px;
  padding: 4px 0 6px;
  overflow: visible;
}

.sp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  transition: background 0.12s;
}
.sp-item:hover { background: var(--fill-subtle); }
.sp-off { opacity: 0.4; }
.sp-inactive { opacity: 0.7; }
.sp-name-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
}

/* 3 态状态点 */
.sp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sp-dot--on {
  background: #30d158;
  box-shadow: 0 0 4px rgba(48, 209, 88,0.7);
}
.sp-dot--inactive {
  background: #ff9f0a;
  box-shadow: 0 0 3px rgba(255, 159, 10,0.5);
}
.sp-dot--off {
  background: transparent;
  border: 1.5px dashed rgba(255,255,255,0.3);
}

.sp-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-desc {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.sp-btn {
  flex-shrink: 0;
  font-size: 10px !important;
  padding: 1px 6px !important;
  height: auto !important;
  line-height: 1.4 !important;
}

.sp-uninstalled {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  white-space: nowrap;
}

/* ── 定时任务内联面板（左侧消息区，与技能面板同区域） ── */
.cron-inline-panel {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  background: rgba(64, 156, 255,0.04);
  max-height: 280px;
  overflow-y: auto;
}
.cron-inline-list { display: flex; flex-direction: column; gap: 2px; }
.cron-inline-item {
  padding: 5px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.1s;
}
.cron-inline-item:hover { background: var(--fill-subtle); }
.cron-inline-header {
  display: flex; align-items: center; gap: 6px;
}
.cron-inline-name {
  flex: 1; font-size: 11px; font-weight: 500; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.cron-inline-schedule {
  font-size: 10px; color: #409cff; white-space: nowrap; flex-shrink: 0;
}
.cron-inline-last {
  font-size: 10px; color: var(--text-secondary); white-space: nowrap; flex-shrink: 0;
}
.cron-inline-message {
  margin-top: 5px; padding: 6px 8px;
  background: rgba(0,0,0,0.2);
  border-radius: 4px;
  font-size: 11px; color: var(--text-primary);
  line-height: 1.55; white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px; overflow-y: auto;
}

/* ── 定时任务 (Cron) 右侧面板残留 CSS 清理 ── */
.cron-count-tag { margin-left: 6px; }
.cron-loading {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-secondary); padding: 8px 0;
}
.cron-list { display: flex; flex-direction: column; gap: 4px; }
.cron-item {
  border: 1px solid var(--border-color);
  border-radius: 7px;
  padding: 8px 10px;
  cursor: pointer;
  transition: background 0.12s;
}
.cron-item:hover { background: var(--fill-subtle); }
.cron-item-header {
  display: flex; align-items: center; gap: 7px;
}
.cron-status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.cron-dot--ok { background: #30d158; box-shadow: 0 0 4px rgba(48, 209, 88,0.5); }
.cron-dot--error { background: #ff453a; box-shadow: 0 0 4px rgba(255, 69, 58,0.5); }
.cron-dot--idle { background: #8e8e93; }
.cron-dot--disabled { background: var(--fill-hover); }
.cron-name {
  flex: 1; font-size: 12px; font-weight: 500; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.cron-schedule {
  font-size: 11px; color: #409cff; white-space: nowrap; flex-shrink: 0;
}
.cron-chevron {
  flex-shrink: 0; color: var(--text-secondary); font-size: 11px;
  transition: transform 0.2s;
}
.cron-chevron--open { transform: rotate(180deg); }
.cron-meta {
  display: flex; gap: 10px; align-items: center;
  font-size: 10px; color: var(--text-secondary);
  margin-top: 3px; padding-left: 14px;
}
.cron-errors { color: #ff6961; }
.cron-message {
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--border-color);
}
.cron-message-label {
  font-size: 10px; color: var(--text-secondary);
  font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; margin-bottom: 4px;
}
.cron-message-text {
  font-size: 12px; color: var(--text-primary);
  line-height: 1.55; white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px; overflow-y: auto;
}

/* ─── #17 @ 提及下拉（@ Mention Dropdown）───────────────────────────────── */
.mention-dropdown {
  position: relative;
  background: #1a2035;
  border: 1px solid rgba(94, 92, 230, 0.3);
  border-radius: 8px;
  margin-bottom: 6px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.mention-item:hover,
.mention-item.active {
  background: rgba(94, 92, 230, 0.12);
}

.mention-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
  border: 1px solid rgba(152, 152, 157, 0.28);
  flex-shrink: 0;
}

.mention-name {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.mention-id {
  font-size: 11px;
  color: #5e5ce6;
  margin-left: auto;
  font-family: monospace;
}

.mention-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: #8e8e93;
  text-align: center;
}
</style>
