package service

// 与上游历史版本兼容：保留模型列表白名单的旧命名。
type GroupModelsListConfig = GroupModelAllowlist

// normalizeGroupModelsListConfig 兼容旧接口。
func normalizeGroupModelsListConfig(cfg GroupModelsListConfig) (GroupModelsListConfig, error) {
	return normalizeGroupModelAllowlist(cfg)
}

func (g *Group) CustomModelsListEnabled() bool {
	return g.ModelAllowlistEnabled()
}
