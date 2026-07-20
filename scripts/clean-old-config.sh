#!/bin/bash
#
# Easy Proxy 配置清理脚本
# 用于清理 localStorage 中的旧配置数据
#

echo "==================================="
echo "Easy Proxy 配置清理工具"
echo "==================================="
echo ""

# 检查配置文件
echo "1. 检查配置文件位置..."
echo ""

if [ -f ~/.ep/settings.json ]; then
    echo "✓ 系统设置: ~/.ep/settings.json"
else
    echo "✗ 系统设置文件不存在"
fi

if [ -f ~/.ep/mocks.json ]; then
    echo "✓ Mock规则: ~/.ep/mocks.json"
else
    echo "✗ Mock规则文件不存在"
fi

if [ -d ~/.ep/route-rules ]; then
    echo "✓ 路由规则目录: ~/.ep/route-rules/"
else
    echo "✗ 路由规则目录不存在（首次启动时将自动创建）"
fi

echo ""
echo "2. 配置文件位置检查完成"
echo ""

# 恢复证书文件到 ca 目录（如果被移出）
if [ ! -d ~/.ep/ca ]; then
    mkdir -p ~/.ep/ca
fi

if [ -f ~/.ep/rootCA.crt ] && [ ! -f ~/.ep/ca/rootCA.crt ]; then
    echo "恢复证书文件到 ca 目录..."
    mv ~/.ep/rootCA.crt ~/.ep/ca/rootCA.crt
    echo "  已移动 rootCA.crt"
fi

if [ -f ~/.ep/rootCA.key ] && [ ! -f ~/.ep/ca/rootCA.key ]; then
    mv ~/.ep/rootCA.key ~/.ep/ca/rootCA.key
    echo "  已移动 rootCA.key"
fi

echo ""
echo "==================================="
echo "配置文件结构："
echo "==================================="
echo ""
echo "~/.ep/"
echo "├── route-rules/        # 路由规则文本文件"
echo "├── mocks.json          # Mock 规则"
echo "├── settings.json       # 系统设置（主题、字体、AI配置）"
echo "└── ca/                 # SSL 证书目录"
echo "    ├── rootCA.crt"
echo "    ├── rootCA.key"
echo "    └── *.crt/*.key     # 动态生成的域名证书"
echo ""
echo "==================================="
echo "清理完成！"
echo "==================================="
echo ""
echo "注意："
echo "- localStorage 中的旧数据已保留作为备份"
echo "- 下次启动时会自动从 localStorage 迁移到文件系统"
echo "- 建议备份 ~/.ep/ 目录：tar -czf ep-backup.tar.gz ~/.ep/"
echo ""
