package toucan

import (
	"context"
	"fmt"
	"time"

	"github.com/grafana/grafana/pkg/infra/log"
	"github.com/grafana/grafana/pkg/services/apikey"
	"github.com/grafana/grafana/pkg/services/serviceaccounts"
)

type Checker interface {
	CheckTokens(ctx context.Context) error
}

type SATokenRetriever interface {
	ListTokens(ctx context.Context, query *serviceaccounts.GetSATokensQuery) ([]apikey.APIKey, error)
	DeleteServiceAccountToken(ctx context.Context, orgID, serviceAccountID, tokenID int64) error
}

// Toucan Service is grafana's service for checking leaked keys.
type Service struct {
	store  SATokenRetriever
	client *client
	logger log.Logger
}

func NewService(store SATokenRetriever) *Service {
	return &Service{
		store:  store,
		client: newClient(),
		logger: log.New("toucan"),
	}
}

func (s *Service) RetrieveActiveTokens(ctx context.Context) ([]apikey.APIKey, error) {
	saTokens, err := s.store.ListTokens(ctx, &serviceaccounts.GetSATokensQuery{
		OrgID:            nil,
		ServiceAccountID: nil,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve service account tokens: %w", err)
	}

	return saTokens, nil
}

// hasExpired returns true if the token has expired.
// Duplicate to SA API. Remerge.
func hasExpired(expiration *int64) bool {
	if expiration == nil {
		return false
	}

	v := time.Unix(*expiration, 0)

	return (v).Before(time.Now())
}

// CheckTokens checks for leaked tokens.
func (s *Service) CheckTokens(ctx context.Context) error {
	// Retrieve all active tokens from the database.
	tokens, err := s.RetrieveActiveTokens(ctx)
	if err != nil {
		return fmt.Errorf("failed to retrieve tokens for checking: %w", err)
	}

	hashes := make([]string, 0, len(tokens))
	hashMap := make(map[string]apikey.APIKey)

	for _, token := range tokens {
		if hasExpired(token.Expires) {
			continue
		}

		hashes = append(hashes, token.Key)
		hashMap[token.Key] = token
	}

	// Check if any leaked tokens exist.
	leakedTokenHashes, err := s.client.checkTokens(ctx, hashes)
	if err != nil {
		return fmt.Errorf("failed to check tokens: %w", err)
	}

	// Revoke leaked tokens.
	// Could be done in bulk but we don't expect more than 1 or 2 tokens to be leaked per check.
	for _, leakedTokenHash := range leakedTokenHashes {
		leakedToken := hashMap[leakedTokenHash]

		if err := s.store.DeleteServiceAccountToken(
			ctx, leakedToken.OrgId, *leakedToken.ServiceAccountId, leakedToken.Id); err != nil {
			return fmt.Errorf("failed to delete leaked token: %w", err)
		}
	}

	return nil
}
