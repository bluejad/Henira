// 权限页（D-080 第五页；R199 管理面）：新会话默认档 + 项目/全局持久规则。
// 本页永不含「本会话」——会话临时允许只在输入框 chip 的规则面板里查看/撤销。
// 规则文件可手改：坏文件只显示警示、绝不覆盖；逐条删除要过确认（deny/全局额外警示）。

import {
  type PermissionMode,
  type PermissionProjectsView,
  type PermissionProjectView,
  type PermissionRule,
  type PermissionRulesView,
  permissionRuleKey,
} from "@henira/protocol";
import { type ReactNode, useEffect, useState } from "react";
import type { WebPartContext } from "../../types.js";
import { CopyButton } from "../copy-button.js";
import { HeniraSelect } from "../dropdown.js";
import { PermissionRuleLine } from "../permission-rule.js";

const MODES: PermissionMode[] = ["ask", "full"];

interface DeleteTarget {
  scope: "project" | "global";
  rule: PermissionRule;
}

function RulesBody(props: {
  ctx: WebPartContext;
  view: PermissionRulesView | null;
  error: boolean;
  emptyKey: string;
  canDelete: boolean;
  onDelete(rule: PermissionRule): void;
  onRetry(): void;
}): ReactNode {
  const { ctx } = props;
  if (props.error) {
    return (
      <div className="henira-permission-rules-state is-error">
        <span>{ctx.t("settings.permission.loadFailed")}</span>
        <button type="button" onClick={props.onRetry}>
          {ctx.t("common.retry")}
        </button>
      </div>
    );
  }
  if (props.view === null) {
    return (
      <div className="henira-permission-rules-state">{ctx.t("settings.permission.loading")}</div>
    );
  }
  if (props.view.status === "corrupt") {
    return (
      <div className="henira-permission-rules-state is-error">
        <span>{ctx.t("settings.permission.fileCorrupt")}</span>
        <button type="button" onClick={props.onRetry}>
          {ctx.t("common.retry")}
        </button>
      </div>
    );
  }
  return (
    <div>
      {props.view.rules.length === 0 ? (
        <div className="henira-permission-rules-state">
          <span>{ctx.t(props.emptyKey)}</span>
          {props.view.status === "missing" ? (
            <button type="button" onClick={props.onRetry}>
              {ctx.t("common.retry")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="henira-permission-rules-list">
          {props.view.rules.map((rule) => (
            <PermissionRuleLine
              key={permissionRuleKey(rule)}
              ctx={ctx}
              rule={rule}
              showDecision
              action={
                props.canDelete ? (
                  <button
                    type="button"
                    className="henira-permission-rule-delete"
                    onClick={() => {
                      props.onDelete(rule);
                    }}
                  >
                    {ctx.t("permission.rule.delete")}
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {props.view.invalidCount > 0 ? (
        <p className="henira-permission-rules-note">
          {ctx
            .t("settings.permission.invalidCount")
            .replace("{n}", String(props.view.invalidCount))}
        </p>
      ) : null}
    </div>
  );
}

function DeleteRuleDialog(props: {
  ctx: WebPartContext;
  target: DeleteTarget;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}): ReactNode {
  const { ctx, target } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !props.busy) props.onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);
  const hint =
    target.scope === "global"
      ? ctx.t(
          target.rule.decision === "deny"
            ? "settings.permission.deleteGlobalDeny"
            : "settings.permission.deleteGlobalAllow",
        )
      : ctx.t(
          target.rule.decision === "deny"
            ? "settings.permission.deleteDenyHint"
            : "settings.permission.deleteAllowHint",
        );
  return (
    <div
      className="henira-overlay"
      role="dialog"
      aria-label={ctx.t("settings.permission.deleteTitle")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !props.busy) props.onCancel();
      }}
    >
      <div className="henira-dialog">
        <div className="henira-dialog-head">
          <strong>{ctx.t("settings.permission.deleteTitle")}</strong>
        </div>
        <div className="henira-dialog-message">
          <PermissionRuleLine ctx={ctx} rule={target.rule} showDecision />
        </div>
        <p className="henira-dialog-message">{hint}</p>
        {props.error !== null ? <p className="henira-send-error">{props.error}</p> : null}
        <div className="henira-dialog-actions">
          <button type="button" disabled={props.busy} onClick={props.onCancel}>
            {ctx.t("common.cancel")}
          </button>
          <button
            type="button"
            className="henira-danger"
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {ctx.t("permission.rule.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionPage(props: { ctx: WebPartContext }): ReactNode {
  const { ctx } = props;
  const [value, setValue] = useState<PermissionMode | undefined>(undefined);
  const [projects, setProjects] = useState<PermissionProjectsView | null>(null);
  const [projectsError, setProjectsError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [project, setProject] = useState<PermissionProjectView | null>(null);
  const [projectError, setProjectError] = useState(false);
  const [global, setGlobal] = useState<PermissionRulesView | null>(null);
  const [globalError, setGlobalError] = useState(false);
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canManage =
    ctx.client.permissionProjects !== undefined &&
    ctx.client.projectPermissions !== undefined &&
    ctx.client.globalPermissions !== undefined;
  const canDeleteProject = ctx.client.removeProjectPermissionRule !== undefined;
  const canDeleteGlobal = ctx.client.removeGlobalPermissionRule !== undefined;

  // 新会话默认档（R197）：挂载读当前默认
  useEffect(() => {
    let alive = true;
    void ctx.client
      .getSettings?.()
      .then((s) => {
        if (alive) setValue(s.permissionMode ?? "ask");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  // 项目清单：打开设置/切会话时重拉，并回到当前会话的项目（无会话 → 第一个）
  useEffect(() => {
    const list = ctx.client.permissionProjects;
    if (list === undefined) return;
    let alive = true;
    setProjectsError(false);
    void list(ctx.sessionId ?? undefined)
      .then((next) => {
        if (!alive) return;
        setProjects(next);
        setSelectedId(next.currentId ?? next.projects[0]?.id ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setProjectsError(true);
        setProjects(null);
      });
    return () => {
      alive = false;
    };
  }, [ctx.client, ctx.sessionId]);

  // 选中项目的规则文件
  useEffect(() => {
    const read = ctx.client.projectPermissions;
    if (read === undefined || selectedId === null) {
      setProject(null);
      return;
    }
    let alive = true;
    setProject(null);
    setProjectError(false);
    void read(selectedId)
      .then((next) => {
        if (alive) setProject(next);
      })
      .catch(() => {
        if (alive) setProjectError(true);
      });
    return () => {
      alive = false;
    };
  }, [ctx.client, selectedId]);

  // 全局规则文件（不属于任何项目）
  useEffect(() => {
    const read = ctx.client.globalPermissions;
    if (read === undefined) return;
    let alive = true;
    setGlobalError(false);
    void read()
      .then((next) => {
        if (alive) setGlobal(next);
      })
      .catch(() => {
        if (alive) setGlobalError(true);
      });
    return () => {
      alive = false;
    };
  }, [ctx.client]);

  const loadProject = async (id: string): Promise<void> => {
    const read = ctx.client.projectPermissions;
    if (read === undefined) return;
    try {
      setProject(await read(id));
      setProjectError(false);
    } catch {
      setProjectError(true);
    }
  };
  const loadGlobal = async (): Promise<void> => {
    const read = ctx.client.globalPermissions;
    if (read === undefined) return;
    try {
      setGlobal(await read());
      setGlobalError(false);
    } catch {
      setGlobalError(true);
    }
  };
  const refreshProjects = async (): Promise<void> => {
    const list = ctx.client.permissionProjects;
    if (list === undefined) return;
    try {
      setProjects(await list(ctx.sessionId ?? undefined));
    } catch {
      // 计数刷新失败不挡删除结果；详情/全局各自有错误态
    }
  };

  const openDelete = (scope: "project" | "global", rule: PermissionRule): void => {
    setDeleteError(null);
    setTarget({ scope, rule });
  };

  const confirmDelete = async (): Promise<void> => {
    if (target === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      if (target.scope === "project") {
        const remove = ctx.client.removeProjectPermissionRule;
        if (remove === undefined || selectedId === null) throw new Error("unsupported");
        await remove(selectedId, target.rule);
      } else {
        const remove = ctx.client.removeGlobalPermissionRule;
        if (remove === undefined) throw new Error("unsupported");
        await remove(target.rule);
      }
      setTarget(null);
      if (target.scope === "project") {
        if (selectedId !== null) await loadProject(selectedId);
        await refreshProjects();
      } else {
        await loadGlobal();
      }
    } catch (err) {
      setDeleteError(
        (err as { status?: number } | undefined)?.status === 409
          ? ctx.t("settings.permission.fileCorrupt")
          : ctx.t("settings.permission.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const selectOptions =
    projects?.projects.map((project) => ({
      value: project.id,
      label: `${project.name} — ${project.cwd}`,
    })) ?? [];
  const selectedProject = projects?.projects.find((project) => project.id === selectedId);

  return (
    <div className="henira-settings-page">
      <header className="henira-settings-page-head">
        <h2>{ctx.t("settings.permission.title")}</h2>
        <p>{ctx.t("settings.permission.hint")}</p>
      </header>
      <div className="henira-settings-card">
        <div className="henira-settings-row">
          <div className="henira-settings-row-text">
            <div className="henira-settings-row-label">{ctx.t("settings.permission.default")}</div>
            <div className="henira-settings-row-hint">
              {ctx.t("settings.permission.defaultHint")}
            </div>
          </div>
          <HeniraSelect
            variant="input"
            ariaLabel={ctx.t("settings.permission.default")}
            value={value ?? "ask"}
            options={MODES.map((mode) => ({
              value: mode,
              label: ctx.t(`composer.permission.${mode}`),
            }))}
            onChange={(next) => {
              setValue(next as PermissionMode);
              void ctx.client
                .putSettings?.({ permissionMode: next as PermissionMode })
                .catch(() => {});
            }}
          />
        </div>
        <div className="henira-settings-row">
          <div className="henira-settings-row-text">
            <div className="henira-settings-row-label">{ctx.t("settings.permission.scope")}</div>
            <div className="henira-settings-row-hint">{ctx.t("settings.permission.scopeHint")}</div>
          </div>
        </div>
      </div>

      {canManage ? (
        <>
          <div className="henira-settings-card henira-permission-rules-card">
            <div className="henira-settings-row">
              <div className="henira-settings-row-text">
                <div className="henira-settings-row-label">
                  {ctx.t("settings.permission.projectRules")}
                </div>
                <div className="henira-settings-row-hint">
                  {ctx.t("settings.permission.projectRulesHint")}
                </div>
                {selectedProject !== undefined ? (
                  <div
                    className="henira-settings-row-hint henira-permission-project-cwd"
                    title={selectedProject.cwd}
                  >
                    {selectedProject.name} · {selectedProject.cwd}
                  </div>
                ) : null}
              </div>
              {selectOptions.length > 0 ? (
                <HeniraSelect
                  variant="input"
                  ariaLabel={ctx.t("settings.permission.selectProject")}
                  value={selectedId ?? ""}
                  options={selectOptions}
                  onChange={(next) => {
                    setSelectedId(next);
                  }}
                />
              ) : null}
            </div>
            <div className="henira-permission-rules-body">
              {projectsError ? (
                <div className="henira-permission-rules-state is-error">
                  <span>{ctx.t("settings.permission.loadFailed")}</span>
                </div>
              ) : projects === null ? (
                <div className="henira-permission-rules-state">
                  {ctx.t("settings.permission.loading")}
                </div>
              ) : projects.projects.length === 0 ? (
                <div className="henira-permission-rules-state">
                  {ctx.t("settings.permission.noProjects")}
                </div>
              ) : (
                <RulesBody
                  ctx={ctx}
                  view={project}
                  error={projectError}
                  emptyKey="settings.permission.emptyProject"
                  canDelete={canDeleteProject}
                  onDelete={(rule) => {
                    openDelete("project", rule);
                  }}
                  onRetry={() => {
                    if (selectedId !== null) void loadProject(selectedId);
                  }}
                />
              )}
            </div>
            {project !== null ? (
              <div className="henira-permission-rules-foot">
                <code className="henira-permission-path" title={project.path}>
                  {project.path}
                </code>
                <CopyButton text={project.path} t={ctx.t} />
              </div>
            ) : null}
          </div>

          <div className="henira-settings-card henira-permission-rules-card">
            <div className="henira-settings-row">
              <div className="henira-settings-row-text">
                <div className="henira-settings-row-label">
                  {ctx.t("settings.permission.globalRules")}
                </div>
                <div className="henira-settings-row-hint">
                  {ctx.t("settings.permission.globalRulesHint")}
                </div>
              </div>
            </div>
            <div className="henira-permission-rules-body">
              <RulesBody
                ctx={ctx}
                view={global}
                error={globalError}
                emptyKey="settings.permission.emptyGlobal"
                canDelete={canDeleteGlobal}
                onDelete={(rule) => {
                  openDelete("global", rule);
                }}
                onRetry={() => {
                  void loadGlobal();
                }}
              />
            </div>
            {global !== null ? (
              <div className="henira-permission-rules-foot">
                <code className="henira-permission-path" title={global.path}>
                  {global.path}
                </code>
                <CopyButton text={global.path} t={ctx.t} />
              </div>
            ) : null}
          </div>
          <p className="henira-permission-session-hint">
            {ctx.t("settings.permission.sessionHint")}
          </p>
        </>
      ) : (
        <p className="henira-permission-session-hint">{ctx.t("settings.permission.unsupported")}</p>
      )}

      {target !== null ? (
        <DeleteRuleDialog
          ctx={ctx}
          target={target}
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return;
            setTarget(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}
    </div>
  );
}

export { PermissionPage };
