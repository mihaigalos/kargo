package stage

import (
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"k8s.io/utils/ptr"

	typesv1alpha1 "github.com/akuity/kargo/internal/api/types/v1alpha1"
	"github.com/akuity/kargo/internal/cli/client"
	"github.com/akuity/kargo/internal/cli/config"
	"github.com/akuity/kargo/internal/cli/option"
	v1alpha1 "github.com/akuity/kargo/pkg/api/service/v1alpha1"
)

func newPromoteSubscribersCommand(
	cfg config.CLIConfig,
	opt *option.Option,
) *cobra.Command {
	var freight string
	cmd := &cobra.Command{
		Use:  "promote-subscribers --project=project (STAGE) [(--freight=)freight-id]",
		Args: option.ExactArgs(1),
		Example: `
# Promote subscribers for a specific project
kargo stage promote-subscribers dev --project=my-project --freight=abc123

# Promote subscribers for the default project
kargo config set project my-project
kargo stage promote-subscribers dev --freight=abc123
`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()

			project := opt.Project
			if project == "" {
				return errors.New("project is required")
			}

			kargoSvcCli, err := client.GetClientFromConfig(ctx, cfg, opt)
			if err != nil {
				return err
			}

			stage := strings.TrimSpace(args[0])
			if stage == "" {
				return errors.New("name is required")
			}

			if freight == "" {
				return errors.New("freight is required")
			}

			res, promoteErr := kargoSvcCli.PromoteSubscribers(ctx, connect.NewRequest(&v1alpha1.PromoteSubscribersRequest{
				Project: project,
				Stage:   stage,
				Freight: freight,
			}))
			if ptr.Deref(opt.PrintFlags.OutputFormat, "") == "" {
				if res != nil && res.Msg != nil {
					for _, p := range res.Msg.GetPromotions() {
						fmt.Fprintf(opt.IOStreams.Out, "Promotion Created: %q\n", *p.Metadata.Name)
					}
				}
				if promoteErr != nil {
					return errors.Wrap(promoteErr, "promote subscribers")
				}
				return nil
			}

			printer, printerErr := opt.PrintFlags.ToPrinter()
			if printerErr != nil {
				return errors.Wrap(printerErr, "new printer")
			}
			for _, p := range res.Msg.GetPromotions() {
				kubeP := typesv1alpha1.FromPromotionProto(p)
				_ = printer.PrintObj(kubeP, opt.IOStreams.Out)
			}
			return promoteErr
		},
	}
	opt.PrintFlags.AddFlags(cmd)
	option.Freight(cmd.Flags(), &freight)
	option.Project(cmd.Flags(), opt, opt.Project)
	return cmd
}
