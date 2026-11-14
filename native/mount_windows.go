//go:build windows

package main

import "errors"

// platform will hold the Cloud Files sync root of one account.
type platform struct{}

func (m *Mount) attach() error {
	return errors.New("A pasta da conta no Windows ainda não faz parte desta compilação.")
}

func (m *Mount) detach() {}
