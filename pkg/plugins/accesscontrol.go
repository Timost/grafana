package plugins

import (
	"context"
	"strings"

	"github.com/grafana/grafana/pkg/models"
	ac "github.com/grafana/grafana/pkg/services/accesscontrol"
	"github.com/grafana/grafana/pkg/services/org"
	"github.com/grafana/grafana/pkg/setting"
)

const (
	// Plugins actions
	ActionInstall = "plugins:install"
	ActionWrite   = "plugins:write"
	ActionRead    = "plugins:read"

	// App Plugins actions
	ActionAppAccess = "plugins.app:access"

	// Class based scopes
	// TODO check if bundle is needed
	ClassBasedScopePrefix = "plugins:class:"
	ExternalScope         = ClassBasedScopePrefix + "external"
	CoreScope             = ClassBasedScopePrefix + "core"
)

var (
	ScopeProvider = ac.NewScopeProvider("plugins")
)

// Protects access to the Configuration > Plugins page
func AdminAccessEvaluator(cfg *setting.Cfg) ac.Evaluator {
	// This is a little hack to preserve the legacy behavior
	// Grafana Admins get access to the page if cfg.PluginAdminEnabled (even if they can only list plugins)
	// Org Admins can access the tab whenever
	if cfg.PluginAdminEnabled {
		return ac.EvalAny(
			ac.EvalPermission(ActionWrite),
			ac.EvalPermission(ActionInstall),
			ac.EvalPermission(ActionRead, ExternalScope))
	}

	// Plugin Admin is disabled  => No installation
	return ac.EvalPermission(ActionWrite)
}

// Legacy handler that protects access to the Configuration > Plugins page
func ReqCanAdminPlugins(cfg *setting.Cfg) func(rc *models.ReqContext) bool {
	return func(rc *models.ReqContext) bool {
		return rc.OrgRole == org.RoleAdmin || cfg.PluginAdminEnabled && rc.IsGrafanaAdmin
	}
}

// Legacy handler that protects listing plugins
func ReqCanReadPlugin(pluginDef PluginDTO) func(c *models.ReqContext) bool {
	fallback := ac.ReqSignedIn
	if !pluginDef.IsCorePlugin() {
		fallback = ac.ReqHasRole(org.RoleAdmin)
	}
	return fallback
}

func DeclareRBACRoles(service ac.Service, cfg *setting.Cfg) error {
	AppPluginsReader := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins.app:reader",
			DisplayName: "Application Plugins Access",
			Description: "Access application plugins (still enforcing the organization role)",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionAppAccess, Scope: ScopeProvider.GetResourceAllScope()},
			},
		},
		Grants: []string{string(org.RoleViewer)},
	}
	PluginsReader := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins:reader",
			DisplayName: "Plugin Reader",
			Description: "List plugins and their settings",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionRead, Scope: CoreScope},
			},
		},
		Grants: []string{string(org.RoleViewer)},
	}
	PluginsWriter := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins:writer",
			DisplayName: "Plugin Writer",
			Description: "Enable and disable plugins and edit plugins' settings",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionWrite, Scope: ScopeProvider.GetResourceAllScope()},
			},
		},
		Grants: []string{string(org.RoleAdmin)},
	}
	PluginsMaintainer := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins:maintainer",
			DisplayName: "Plugin Maintainer",
			Description: "Install, uninstall plugins",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionInstall},
			},
		},
		Grants: []string{ac.RoleGrafanaAdmin},
	}

	if !cfg.PluginAdminEnabled || cfg.PluginAdminExternalManageEnabled {
		PluginsMaintainer.Grants = []string{}
	}

	PluginsExternalReader := ac.RoleRegistration{
		Role: ac.RoleDTO{
			Name:        ac.FixedRolePrefix + "plugins.external:reader",
			DisplayName: "External Plugin Reader",
			Description: "List non core plugins and their settings",
			Group:       "Plugins",
			Permissions: []ac.Permission{
				{Action: ActionRead, Scope: ExternalScope},
			},
		},
		Grants: []string{string(org.RoleAdmin), ac.RoleGrafanaAdmin},
	}

	return service.DeclareFixedRoles(AppPluginsReader, PluginsReader, PluginsWriter, PluginsMaintainer, PluginsExternalReader)
}

// NewIDScopeResolver provides an ScopeAttributeResolver able to
// translate a scope prefixed with "plugins:id" into an class based scope.
func NewIDScopeResolver(db Store) (string, ac.ScopeAttributeResolver) {
	prefix := ScopeProvider.GetResourceScope("")
	return prefix, ac.ScopeAttributeResolverFunc(func(ctx context.Context, orgID int64, initialScope string) ([]string, error) {
		if !strings.HasPrefix(initialScope, prefix) {
			return nil, ac.ErrInvalidScope
		}

		pluginID := initialScope[len(prefix):]
		if pluginID == "" {
			return nil, ac.ErrInvalidScope
		}

		plugin, exists := db.Plugin(ctx, pluginID)
		if !exists {
			return nil, ErrPluginNotInstalled // TODO replace error
		}

		if plugin.IsCorePlugin() {
			return []string{initialScope, CoreScope}, nil
		}

		return []string{initialScope, ExternalScope}, nil
	})
}
